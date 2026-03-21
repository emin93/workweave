import { exec } from "child_process";
import { promisify } from "util";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

const execAsync = promisify(exec);

let _resolvedGhPath: string | null = null;

async function resolveGhPath(): Promise<string> {
  if (_resolvedGhPath) return _resolvedGhPath;

  // Try PATH first
  try {
    await execAsync("gh --version", { timeout: 3000 });
    _resolvedGhPath = "gh";
    return _resolvedGhPath;
  } catch {
    // not on PATH
  }

  // Windows default install location
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\GitHub CLI\\gh.exe",
      "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
    ];
    for (const p of candidates) {
      try {
        await execAsync(`"${p}" --version`, { timeout: 3000 });
        _resolvedGhPath = `"${p}"`;
        return _resolvedGhPath;
      } catch {
        // try next
      }
    }
  }

  // macOS Homebrew
  if (process.platform === "darwin") {
    for (const p of ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]) {
      try {
        await execAsync(`${p} --version`, { timeout: 3000 });
        _resolvedGhPath = p;
        return _resolvedGhPath;
      } catch {
        // try next
      }
    }
  }

  throw new Error("GitHub CLI (gh) not found");
}

function ghPath(): string {
  return _resolvedGhPath ?? "gh";
}

async function gh(args: string): Promise<string> {
  const cmd = `${ghPath()} ${args}`;
  const { stdout } = await execAsync(cmd, {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
  });
  return stdout.trim();
}

async function ghJson<T = unknown>(args: string): Promise<T> {
  const raw = await gh(args);
  if (!raw) return [] as unknown as T;
  return JSON.parse(raw) as T;
}

export class GitHubConnector implements Connector {
  id = "github";
  name = "GitHub";
  icon = "github";

  async detect(): Promise<ConnectorStatus> {
    try {
      await resolveGhPath();
    } catch {
      return {
        available: false,
        reason: "GitHub CLI not installed",
        setupInstructions:
          "Install GitHub CLI: https://cli.github.com/ then run `gh auth login`",
      };
    }

    try {
      // gh auth status prints to stderr and exits non-zero when not logged in
      const { stdout, stderr } = await execAsync(
        `${ghPath()} auth status 2>&1`,
        { timeout: 5000 }
      );
      const output = stdout + stderr;
      if (output.includes("Logged in") || output.includes("Token:")) {
        return { available: true, authMethod: "cli" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Logged in") || msg.includes("Token:")) {
        return { available: true, authMethod: "cli" };
      }
    }

    return {
      available: false,
      reason: "GitHub CLI not authenticated",
      setupInstructions: "Run `gh auth login` in your terminal",
    };
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
    const errors: string[] = [];

    // Fetch PRs requesting your review (global, not repo-scoped)
    try {
      const prs = await this.fetchReviewRequests();
      for (const pr of prs) {
        events.push({
          id: `github-pr-${pr.number}-${pr.repository.nameWithOwner}`,
          connectorId: this.id,
          sourceType: "pr",
          rawPayload: pr,
          fetchedAt: now,
        });
      }
    } catch (err) {
      errors.push(`PRs: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fetch assigned issues (global, not repo-scoped)
    try {
      const issues = await this.fetchAssignedIssues();
      for (const issue of issues) {
        events.push({
          id: `github-issue-${issue.number}-${issue.repository.nameWithOwner}`,
          connectorId: this.id,
          sourceType: "issue",
          rawPayload: issue,
          fetchedAt: now,
        });
      }
    } catch (err) {
      errors.push(`Issues: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (events.length === 0 && errors.length > 0) {
      throw new Error(`GitHub fetch failed: ${errors.join("; ")}`);
    }

    return events;
  }

  /**
   * Uses `gh api` with the search endpoint to find PRs across all repos
   * where the current user is requested as a reviewer.
   */
  private async fetchReviewRequests(): Promise<GitHubSearchPR[]> {
    const username = await gh("api user --jq .login");
    const raw = await gh(
      `api "search/issues?q=is:open+is:pr+review-requested:${username}+archived:false&per_page=25" --jq ".items"`
    );
    if (!raw || raw === "null") return [];
    const items = JSON.parse(raw) as GitHubSearchItem[];
    return items.map(searchItemToPR);
  }

  /**
   * Uses `gh api` with the search endpoint to find issues assigned to the
   * current user across all repos.
   */
  private async fetchAssignedIssues(): Promise<GitHubSearchIssue[]> {
    const username = await gh("api user --jq .login");
    const raw = await gh(
      `api "search/issues?q=is:open+is:issue+assignee:${username}+archived:false&per_page=25" --jq ".items"`
    );
    if (!raw || raw === "null") return [];
    const items = JSON.parse(raw) as GitHubSearchItem[];
    return items.map(searchItemToIssue);
  }
}

function searchItemToPR(item: GitHubSearchItem): GitHubSearchPR {
  const repoFullName = item.repository_url.replace(
    "https://api.github.com/repos/",
    ""
  );
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    headRefName: item.pull_request?.head?.ref ?? "",
    additions: 0,
    deletions: 0,
    author: { login: item.user?.login ?? "unknown" },
    labels: (item.labels ?? []).map((l) =>
      typeof l === "string" ? { name: l } : { name: l.name ?? "" }
    ),
    reviewRequests: [],
    repository: { nameWithOwner: repoFullName },
  };
}

function searchItemToIssue(item: GitHubSearchItem): GitHubSearchIssue {
  const repoFullName = item.repository_url.replace(
    "https://api.github.com/repos/",
    ""
  );
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    author: { login: item.user?.login ?? "unknown" },
    labels: (item.labels ?? []).map((l) =>
      typeof l === "string" ? { name: l } : { name: l.name ?? "" }
    ),
    repository: { nameWithOwner: repoFullName },
  };
}

interface GitHubSearchItem {
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

interface GitHubSearchPR {
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
  repository: { nameWithOwner: string };
}

interface GitHubSearchIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  repository: { nameWithOwner: string };
}
