import * as https from "https";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

const userCache = new Map<string, string>();

async function slackApi<T>(
  token: string,
  method: string,
  params: Record<string, string> = {}
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `https://slack.com/api/${method}${qs ? `?${qs}` : ""}`;

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              reject(new Error(`Slack API error: ${parsed.error}`));
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new Error("Failed to parse Slack response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error("Slack API timeout"));
    });
  });
}

async function resolveUserId(token: string, userId: string): Promise<string> {
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const resp = await slackApi<UserInfoResponse>(token, "users.info", {
      user: userId,
    });
    const name =
      resp.user?.profile?.display_name ||
      resp.user?.real_name ||
      resp.user?.name ||
      userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

function cleanSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(text: string): string[] {
  const links: string[] = [];
  const linkPattern = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g;
  let m;
  while ((m = linkPattern.exec(text)) !== null) {
    links.push(m[1]);
  }
  return links;
}

function isDmChannel(channelId: string | undefined): boolean {
  return !!channelId && channelId.startsWith("D");
}

async function parseMatch(token: string, match: SearchMatch): Promise<Record<string, unknown>> {
  const channelId = match.channel?.id ?? "";
  const rawChannelName = match.channel?.name ?? "";
  const isDm = isDmChannel(channelId);

  let channelLabel: string;
  if (isDm) channelLabel = "DM";
  else if (rawChannelName && !/^[A-Z0-9]+$/.test(rawChannelName)) channelLabel = rawChannelName;
  else channelLabel = rawChannelName || "unknown";

  const rawFrom = match.username ?? match.user ?? "someone";
  let fromDisplay = rawFrom;
  if (/^[A-Z0-9]{9,}$/.test(rawFrom)) {
    fromDisplay = await resolveUserId(token, rawFrom);
  }

  const cleanText = cleanSlackText(match.text ?? "");
  const links = extractLinks(match.text ?? "");

  return {
    text: match.text,
    cleanText,
    channel: channelLabel,
    channelId,
    isDm,
    from: fromDisplay,
    ts: match.ts,
    permalink: match.permalink ?? "",
    threadTs: match.ts,
    links,
  };
}

export class SlackConnector implements Connector {
  id = "slack";
  name = "Slack";
  icon = "message-square";

  async detect(): Promise<ConnectorStatus> {
    if (!process.env.SLACK_USER_TOKEN) {
      return {
        available: false,
        reason: "SLACK_USER_TOKEN is not set",
        setupInstructions:
          "Set SLACK_USER_TOKEN (xoxp-...) with scopes: search:read, users:read, channels:read, groups:read, im:read.",
      };
    }
    return { available: true, authMethod: "token" };
  }

  async authenticate(): Promise<boolean> {
    const token = process.env.SLACK_USER_TOKEN;
    if (!token) return false;
    try {
      await slackApi(token, "auth.test");
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        type: "slack_message",
        description: "Messages mentioning you or sent to you",
      },
    ];
  }

  async fetch(): Promise<RawEvent[]> {
    const token = process.env.SLACK_USER_TOKEN;
    if (!token) return [];

    const events: RawEvent[] = [];
    const now = new Date().toISOString();

    const authInfo = await slackApi<AuthTestResponse>(token, "auth.test");
    const userId = authInfo.user_id;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    try {
      const results = await slackApi<SearchResponse>(token, "search.messages", {
        query: `<@${userId}>`,
        sort: "timestamp",
        sort_dir: "desc",
        count: "20",
      });

      for (const match of results.messages?.matches ?? []) {
        if (Number(match.ts) < oneDayAgo) continue;
        const parsed = await parseMatch(token, match);
        events.push({
          id: `slack-mention-${match.iid ?? match.ts}`,
          connectorId: this.id,
          sourceType: "slack_message",
          rawPayload: parsed,
          fetchedAt: now,
        });
      }
    } catch {
      // Optional in some workspaces/tokens.
    }

    return events;
  }
}

interface AuthTestResponse {
  ok: boolean;
  user_id: string;
}

interface UserInfoResponse {
  ok: boolean;
  user?: {
    name?: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
    };
  };
}

interface SearchResponse {
  ok: boolean;
  messages?: {
    matches: SearchMatch[];
  };
}

interface SearchMatch {
  iid?: string;
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  permalink?: string;
  channel?: {
    id?: string;
    name?: string;
  };
}
