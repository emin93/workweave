import * as vscode from "vscode";
import * as https from "https";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

const SLACK_SECRET_KEY = "workday.slack.token";

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

export class SlackConnector implements Connector {
  id = "slack";
  name = "Slack";
  icon = "message-square";

  private _context: vscode.ExtensionContext | null = null;

  setContext(context: vscode.ExtensionContext) {
    this._context = context;
  }

  async detect(): Promise<ConnectorStatus> {
    if (!this._context) {
      return {
        available: false,
        reason: "Extension context not set",
        setupInstructions: "Internal error — restart the extension.",
      };
    }

    const token = await this._context.secrets.get(SLACK_SECRET_KEY);
    if (!token) {
      return {
        available: false,
        reason: "No Slack token configured",
        setupInstructions: [
          "To connect Slack, you need a User OAuth Token (xoxp-...):",
          "",
          "1. Go to https://api.slack.com/apps and create a new app",
          "2. Under OAuth & Permissions, add these User Token Scopes:",
          "   • search:read",
          "   • users:read",
          "   • channels:read",
          "   • groups:read",
          "   • im:read",
          "3. Install the app to your workspace",
          '4. Copy the "User OAuth Token" (starts with xoxp-)',
          '5. Run command "Workday: Set Slack Token" in Cursor',
        ].join("\n"),
      };
    }

    // Validate the token
    try {
      await slackApi(token, "auth.test");
      return { available: true, authMethod: "token" };
    } catch (err) {
      return {
        available: false,
        reason: "Slack token is invalid or expired",
        setupInstructions:
          'Run "Workday: Set Slack Token" to update your token.',
      };
    }
  }

  async authenticate(): Promise<boolean> {
    const status = await this.detect();
    return status.available;
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
    if (!this._context) return [];

    const token = await this._context.secrets.get(SLACK_SECRET_KEY);
    if (!token) return [];

    const events: RawEvent[] = [];
    const now = new Date().toISOString();

    // Get current user ID
    const authInfo = await slackApi<AuthTestResponse>(token, "auth.test");
    const userId = authInfo.user_id;

    // Search for recent messages mentioning the user (last 24h)
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

        const channelName = match.channel?.name ?? "unknown";
        const permalink = match.permalink ?? "";
        const fromUser = match.username ?? match.user ?? "someone";

        events.push({
          id: `slack-mention-${match.iid ?? match.ts}`,
          connectorId: this.id,
          sourceType: "slack_message",
          rawPayload: {
            text: match.text,
            channel: channelName,
            channelId: match.channel?.id,
            from: fromUser,
            ts: match.ts,
            permalink,
            threadTs: match.ts,
          },
          fetchedAt: now,
        });
      }
    } catch {
      // search.messages might not be available with all token types
    }

    // Search for DMs sent to the user (last 24h)
    try {
      const results = await slackApi<SearchResponse>(token, "search.messages", {
        query: `to:<@${userId}>`,
        sort: "timestamp",
        sort_dir: "desc",
        count: "10",
      });

      const existingIds = new Set(events.map((e) => e.id));
      for (const match of results.messages?.matches ?? []) {
        if (Number(match.ts) < oneDayAgo) continue;

        const id = `slack-dm-${match.iid ?? match.ts}`;
        if (existingIds.has(id)) continue;

        const channelName = match.channel?.name ?? "DM";
        const fromUser = match.username ?? match.user ?? "someone";

        events.push({
          id,
          connectorId: this.id,
          sourceType: "slack_message",
          rawPayload: {
            text: match.text,
            channel: channelName,
            channelId: match.channel?.id,
            from: fromUser,
            ts: match.ts,
            permalink: match.permalink ?? "",
            threadTs: match.ts,
          },
          fetchedAt: now,
        });
      }
    } catch {
      // Silently skip
    }

    return events;
  }

  /** Called by the "Set Slack Token" command */
  static async promptForToken(
    context: vscode.ExtensionContext
  ): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      title: "Slack User OAuth Token",
      prompt: "Paste your Slack User OAuth Token (starts with xoxp-)",
      placeHolder: "xoxp-...",
      password: true,
      validateInput: (value) => {
        if (!value) return "Token is required";
        if (!value.startsWith("xoxp-") && !value.startsWith("xoxb-")) {
          return "Token should start with xoxp- or xoxb-";
        }
        return null;
      },
    });

    if (!token) return false;

    // Validate before saving
    try {
      await slackApi(token, "auth.test");
    } catch (err) {
      vscode.window.showErrorMessage(
        `Invalid Slack token: ${err instanceof Error ? err.message : err}`
      );
      return false;
    }

    await context.secrets.store(SLACK_SECRET_KEY, token);
    vscode.window.showInformationMessage(
      "Slack token saved. Re-run onboarding or sync to use it."
    );
    return true;
  }
}

interface AuthTestResponse {
  ok: boolean;
  user_id: string;
  team_id: string;
  user: string;
}

interface SearchResponse {
  ok: boolean;
  messages?: {
    matches: SearchMatch[];
    total: number;
  };
}

interface SearchMatch {
  iid?: string;
  ts: string;
  text: string;
  user?: string;
  username?: string;
  permalink?: string;
  channel?: {
    id: string;
    name: string;
  };
}
