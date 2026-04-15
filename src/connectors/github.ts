import * as https from "https";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

async function githubApi<T>(
  token: string,
  path: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "workweave",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 401) {
            reject(new Error("GitHub token is invalid or expired"));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API error: HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error("Failed to parse GitHub API response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error("GitHub API timeout"));
    });
    req.end();
  });
}

export class GitHubConnector implements Connector {
  id = "github";
  name = "GitHub";
  icon = "github";

  private _token: string | null = null;
  private _username: string | null = null;

  async detect(): Promise<ConnectorStatus> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        available: false,
        reason: "GITHUB_TOKEN is not set",
        setupInstructions: [
          "1. Go to github.com/settings/tokens → Generate new token (classic)",
          "2. Name it 'Workweave', set expiration",
          "3. Select scope: repo",
          "4. Generate and copy the token",
          "5. Run `workweave setup` and paste it when prompted",
        ].join("\n"),
      };
    }

    try {
      const user = await githubApi<{ login: string }>(token, "/user");
      if (!user.login) throw new Error("No login in response");
      return { available: true, authMethod: "token" };
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : "GitHub token validation failed",
        setupInstructions: "Run `workweave setup` to update your GITHUB_TOKEN.",
      };
    }
  }

  async authenticate(): Promise<boolean> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return false;
    try {
      const user = await githubApi<{ login: string }>(token, "/user");
      this._token = token;
      this._username = user.login;
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      { type: "pr", description: "Pull requests assigned or requesting your review" },
      { type: "issue", description: "Issues assigned to you" },
    ];
  }

  async fetch(): Promise<RawEvent[]> {
    if (!this._token || !this._username) {
      const ok = await this.authenticate();
      if (!ok) throw new Error("GitHub authentication failed");
    }

    const token = this._token!;
    const username = this._username!;
    const events: RawEvent[] = [];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const errors: string[] = [];

    const queries: Array<{ label: string; q: string; sourceType: string }> = [
      {
        label: "review-requested PRs",
        q: `is:open+is:pr+review-requested:${username}+archived:false`,
        sourceType: "pr",
      },
      {
        label: "authored PRs",
        q: `is:open+is:pr+author:${username}+archived:false`,
        sourceType: "pr",
      },
      {
        label: "assigned issues",
        q: `is:open+is:issue+assignee:${username}+archived:false`,
        sourceType: "issue",
      },
    ];

    for (const { label, q, sourceType } of queries) {
      try {
        const result = await githubApi<{ items: SearchItem[] }>(
          token,
          `/search/issues?q=${q}&per_page=25`
        );
        for (const item of result.items ?? []) {
          const repo = repoFromUrl(item.repository_url);
          const key = `github-${sourceType}-${item.number}-${repo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({
            id: key,
            connectorId: this.id,
            sourceType,
            rawPayload: toPayload(item, username),
            fetchedAt: now,
          });
        }
      } catch (err) {
        errors.push(`${label}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (events.length === 0 && errors.length > 0) {
      throw new Error(`GitHub fetch failed: ${errors.join("; ")}`);
    }

    return events;
  }
}

function repoFromUrl(repositoryUrl: string): string {
  return repositoryUrl.replace("https://api.github.com/repos/", "");
}

function toPayload(
  item: SearchItem,
  currentUser: string
): Record<string, unknown> {
  const authorLogin = item.user?.login ?? "unknown";
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    author: { login: authorLogin },
    isAuthor: authorLogin.toLowerCase() === currentUser.toLowerCase(),
    labels: (item.labels ?? []).map((l) =>
      typeof l === "string" ? { name: l } : { name: l.name ?? "" }
    ),
    repository: { nameWithOwner: repoFromUrl(item.repository_url) },
    headRefName: item.pull_request?.head?.ref ?? "",
    additions: 0,
    deletions: 0,
    reviewRequests: [],
  };
}

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
  updated_at: string;
  user?: { login: string };
  labels?: Array<string | { name?: string }>;
  pull_request?: { head?: { ref?: string } };
}
