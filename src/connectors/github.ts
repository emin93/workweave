import { execFile } from "child_process";
import { promisify } from "util";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";

const execFileAsync = promisify(execFile);

const WINDOWS_PATHS = [
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
];
const MAC_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

let _ghPath: string | null = null;

async function runGh(args: string[]): Promise<string> {
  const ghExe = await findGh();
  const { stdout } = await execFileAsync(ghExe, args, {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
  });
  return stdout.trim();
}

async function findGh(): Promise<string> {
  if (_ghPath) return _ghPath;

  // Try "gh" on PATH
  try {
    await execFileAsync("gh", ["--version"], { timeout: 3000 });
    _ghPath = "gh";
    return _ghPath;
  } catch {
    // not on PATH
  }

  // Try platform-specific paths
  const candidates =
    process.platform === "win32"
      ? WINDOWS_PATHS
      : process.platform === "darwin"
        ? MAC_PATHS
        : [];

  for (const p of candidates) {
    try {
      await execFileAsync(p, ["--version"], { timeout: 3000 });
      _ghPath = p;
      return _ghPath;
    } catch {
      // try next
    }
  }

  throw new Error("GitHub CLI (gh) not found");
}

export class GitHubConnector implements Connector {
  id = "github";
  name = "GitHub";
  icon = "github";

  async detect(): Promise<ConnectorStatus> {
    try {
      await findGh();
    } catch {
      return {
        available: false,
        reason: "GitHub CLI not installed",
        setupInstructions: [
          "1. Install the GitHub CLI from https://cli.github.com",
          "   • Windows: winget install GitHub.cli",
          "   • macOS: brew install gh",
          "   • Linux: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
          "2. Run: gh auth login",
          "3. Re-run `workday detect`",
          "4. Use `workday synth --connectors github`",
        ].join("\n"),
      };
    }

    try {
      const output = await runGh(["auth", "status"]);
      if (output.includes("Logged in") || output.includes("Token:")) {
        return { available: true, authMethod: "cli" };
      }
    } catch (err) {
      // gh auth status exits non-zero but prints status to stderr which
      // execFile captures in the error object
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const combined = msg + stderr;
      if (combined.includes("Logged in") || combined.includes("Token:")) {
        return { available: true, authMethod: "cli" };
      }
    }

    return {
      available: false,
      reason: "GitHub CLI not authenticated",
      setupInstructions: [
        "1. Open a terminal",
        "2. Run: gh auth login",
        "3. Follow the prompts to authenticate with GitHub",
        "4. Re-run `workday detect` or `workday synth`",
      ].join("\n"),
    };
  }

  async authenticate(): Promise<boolean> {
    const status = await this.detect();
    return status.available;
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        type: "pr",
        description: "Pull requests assigned or requesting your review",
      },
      { type: "issue", description: "Issues assigned to you" },
    ];
  }

  async fetch(): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const now = new Date().toISOString();
    const errors: string[] = [];

    const username = await runGh(["api", "user", "--jq", ".login"]);

    const seen = new Set<string>();

    // Fetch PRs requesting your review
    try {
      const raw = await runGh([
        "api",
        `search/issues?q=is:open+is:pr+review-requested:${username}+archived:false&per_page=25`,
        "--jq",
        ".items",
      ]);
      if (raw && raw !== "null") {
        const items = JSON.parse(raw) as SearchItem[];
        for (const item of items) {
          const key = `github-pr-${item.number}-${repoFromUrl(item.repository_url)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({
            id: key,
            connectorId: this.id,
            sourceType: "pr",
            rawPayload: toPayload(item, username),
            fetchedAt: now,
          });
        }
      }
    } catch (err) {
      errors.push(`PRs: ${err instanceof Error ? err.message : err}`);
    }

    // Fetch PRs authored by you
    try {
      const raw = await runGh([
        "api",
        `search/issues?q=is:open+is:pr+author:${username}+archived:false&per_page=25`,
        "--jq",
        ".items",
      ]);
      if (raw && raw !== "null") {
        const items = JSON.parse(raw) as SearchItem[];
        for (const item of items) {
          const key = `github-pr-${item.number}-${repoFromUrl(item.repository_url)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({
            id: key,
            connectorId: this.id,
            sourceType: "pr",
            rawPayload: toPayload(item, username),
            fetchedAt: now,
          });
        }
      }
    } catch (err) {
      errors.push(`Authored PRs: ${err instanceof Error ? err.message : err}`);
    }

    // Fetch assigned issues
    try {
      const raw = await runGh([
        "api",
        `search/issues?q=is:open+is:issue+assignee:${username}+archived:false&per_page=25`,
        "--jq",
        ".items",
      ]);
      if (raw && raw !== "null") {
        const items = JSON.parse(raw) as SearchItem[];
        for (const item of items) {
          events.push({
            id: `github-issue-${item.number}-${repoFromUrl(item.repository_url)}`,
            connectorId: this.id,
            sourceType: "issue",
            rawPayload: toPayload(item, username),
            fetchedAt: now,
          });
        }
      }
    } catch (err) {
      errors.push(`Issues: ${err instanceof Error ? err.message : err}`);
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
  currentUser?: string
): Record<string, unknown> {
  const authorLogin = item.user?.login ?? "unknown";
  return {
    number: item.number,
    title: item.title,
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    author: { login: authorLogin },
    isAuthor: currentUser
      ? authorLogin.toLowerCase() === currentUser.toLowerCase()
      : false,
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
