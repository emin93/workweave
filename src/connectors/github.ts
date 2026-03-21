import { exec } from "child_process";
import { promisify } from "util";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

const execAsync = promisify(exec);

async function gh(args: string): Promise<string> {
  const { stdout } = await execAsync(`gh ${args}`, {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout.trim();
}

async function ghJson<T = unknown>(args: string): Promise<T> {
  const raw = await gh(args);
  return JSON.parse(raw) as T;
}

export class GitHubConnector implements Connector {
  id = "github";
  name = "GitHub";
  icon = "github";

  async detect(): Promise<ConnectorStatus> {
    try {
      await execAsync("gh --version", { timeout: 5000 });
      const { stdout } = await execAsync("gh auth status 2>&1", {
        timeout: 5000,
      });
      if (
        stdout.includes("Logged in") ||
        stdout.includes("Token:")
      ) {
        return { available: true, authMethod: "cli" };
      }
      return {
        available: false,
        reason: "GitHub CLI not authenticated",
        setupInstructions: "Run `gh auth login` in your terminal",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("not recognized")) {
        return {
          available: false,
          reason: "GitHub CLI not installed",
          setupInstructions:
            "Install GitHub CLI: https://cli.github.com/ then run `gh auth login`",
        };
      }
      // gh auth status exits non-zero but still prints status to stderr
      if (msg.includes("Logged in") || msg.includes("Token:")) {
        return { available: true, authMethod: "cli" };
      }
      return {
        available: false,
        reason: "GitHub CLI not authenticated",
        setupInstructions: "Run `gh auth login` in your terminal",
      };
    }
  }

  async authenticate(): Promise<boolean> {
    const status = await this.detect();
    return status.available;
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      { type: "pr", description: "Pull requests assigned or requesting your review" },
      { type: "issue", description: "Issues assigned to you" },
    ];
  }

  async fetch(): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const now = new Date().toISOString();

    try {
      const prs = await this.fetchPRs();
      for (const pr of prs) {
        events.push({
          id: `github-pr-${pr.number}-${pr.repository?.nameWithOwner ?? "unknown"}`,
          connectorId: this.id,
          sourceType: "pr",
          rawPayload: pr,
          fetchedAt: now,
        });
      }
    } catch {
      // Silently skip if PR fetch fails
    }

    try {
      const issues = await this.fetchIssues();
      for (const issue of issues) {
        events.push({
          id: `github-issue-${issue.number}-${issue.repository?.nameWithOwner ?? "unknown"}`,
          connectorId: this.id,
          sourceType: "issue",
          rawPayload: issue,
          fetchedAt: now,
        });
      }
    } catch {
      // Silently skip if issue fetch fails
    }

    return events;
  }

  private async fetchPRs(): Promise<GitHubPR[]> {
    const reviewRequested = await ghJson<GitHubPR[]>(
      `pr list --search "review-requested:@me" --state open --json number,title,url,createdAt,updatedAt,author,labels,reviewRequests,repository,headRefName,additions,deletions --limit 25`
    );

    const assigned = await ghJson<GitHubPR[]>(
      `pr list --search "assignee:@me" --state open --json number,title,url,createdAt,updatedAt,author,labels,reviewRequests,repository,headRefName,additions,deletions --limit 25`
    );

    const seen = new Set<string>();
    const merged: GitHubPR[] = [];
    for (const pr of [...reviewRequested, ...assigned]) {
      const key = `${pr.repository?.nameWithOwner}#${pr.number}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(pr);
      }
    }
    return merged;
  }

  private async fetchIssues(): Promise<GitHubIssue[]> {
    return ghJson<GitHubIssue[]>(
      `issue list --search "assignee:@me" --state open --json number,title,url,createdAt,updatedAt,author,labels,repository --limit 25`
    );
  }
}

interface GitHubPR {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  author: { login: string };
  labels: Array<{ name: string }>;
  reviewRequests: Array<{ login?: string; name?: string }>;
  repository?: { nameWithOwner: string };
}

interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  repository?: { nameWithOwner: string };
}
