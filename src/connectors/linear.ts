import * as vscode from "vscode";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";
import * as https from "https";

const LINEAR_API = "https://api.linear.app/graphql";

let _log: vscode.LogOutputChannel | undefined;
function log(): vscode.LogOutputChannel {
  if (!_log) {
    _log = vscode.window.createOutputChannel("Workday Synthesizer", {
      log: true,
    });
  }
  return _log;
}

async function linearQuery<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const url = new URL(LINEAR_API);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.errors) {
              log().error(
                `[linear] API errors: ${JSON.stringify(parsed.errors)}`
              );
              reject(
                new Error(parsed.errors[0]?.message ?? "Linear API error")
              );
            } else if (!parsed.data) {
              log().error(
                `[linear] No data in response: ${data.slice(0, 500)}`
              );
              reject(new Error("Linear API returned no data"));
            } else {
              resolve(parsed.data as T);
            }
          } catch {
            reject(
              new Error(
                `Failed to parse Linear response (HTTP ${res.statusCode})`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error("Linear API timeout"));
    });
    req.write(body);
    req.end();
  });
}

export class LinearConnector implements Connector {
  id = "linear";
  name = "Linear";
  icon = "list-ordered";

  private _token: string | null = null;

  async detect(): Promise<ConnectorStatus> {
    try {
      const ext = vscode.extensions.getExtension("linear.linear-connect");
      if (ext) {
        return { available: true, authMethod: "extension" };
      }
    } catch {
      // Extension not available
    }

    return {
      available: false,
      reason: "Linear Connect extension not installed",
      setupInstructions: [
        "1. Open the Extensions panel (Ctrl+Shift+X)",
        '2. Search for "Linear" by Linear',
        "3. Install the Linear Connect extension",
        "4. Restart Cursor / VS Code",
        "5. Re-run onboarding — Linear will appear as Ready",
        "",
        "The extension handles authentication automatically",
        "via OAuth when you first sync.",
      ].join("\n"),
    };
  }

  async authenticate(): Promise<boolean> {
    try {
      let session = await vscode.authentication.getSession(
        "linear",
        ["read"],
        { silent: true }
      );

      if (!session) {
        session = await vscode.authentication.getSession(
          "linear",
          ["read"],
          { createIfNone: true }
        );
      }

      if (session) {
        this._token = session.accessToken;
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("User did not consent")) {
        throw new Error(`Linear authentication failed: ${msg}`);
      }
    }
    return false;
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      { type: "issue", description: "Issues assigned to you or created by you" },
    ];
  }

  async fetch(): Promise<RawEvent[]> {
    if (!this._token) {
      const ok = await this.authenticate();
      if (!ok) {
        throw new Error(
          "Linear authentication required. A browser window should have opened — please sign in and sync again."
        );
      }
    }

    const events: RawEvent[] = [];
    const seen = new Set<string>();
    const now = new Date().toISOString();

    // Get viewer info (needed for createdIssues query)
    const me = await linearQuery<{
      viewer: { id: string; name: string; email: string };
    }>(this._token!, `query { viewer { id name email } }`);
    log().info(
      `[linear] Authenticated as: ${me.viewer?.name} (${me.viewer?.email})`
    );

    const addIssues = (issues: LinearIssue[], source: string) => {
      for (const issue of issues) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        events.push({
          id: `linear-issue-${issue.identifier}`,
          connectorId: this.id,
          sourceType: "issue",
          rawPayload: issue,
          fetchedAt: now,
        });
      }
      log().info(`[linear] ${source}: ${issues.length} issue(s)`);
    };

    // 1. Issues assigned to the viewer
    const assigned = await linearQuery<ViewerIssuesResponse>(
      this._token!,
      ASSIGNED_ISSUES_QUERY
    );
    addIssues(assigned.viewer?.assignedIssues?.nodes ?? [], "Assigned");

    // 2. Issues created by the viewer (that are still active)
    const created = await linearQuery<{ issues: { nodes: LinearIssue[] } }>(
      this._token!,
      CREATED_ISSUES_QUERY,
      { userId: me.viewer.id }
    );
    addIssues(created.issues?.nodes ?? [], "Created by you");

    // 3. Issues from the viewer's active team cycles
    try {
      const teams = await linearQuery<TeamsResponse>(
        this._token!,
        TEAM_CYCLE_QUERY
      );
      for (const team of teams.viewer?.teams?.nodes ?? []) {
        const cycle = team.activeCycle;
        if (!cycle?.issues?.nodes) continue;
        addIssues(cycle.issues.nodes, `Cycle: ${team.name}`);
      }
    } catch {
      // Team/cycle query may fail if no teams — that's fine
    }

    log().info(`[linear] Total unique issues: ${events.length}`);
    return events;
  }
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  priorityLabel
  estimate
  dueDate
  createdAt
  updatedAt
  state { name type }
  assignee { id name }
  labels { nodes { name } }
  project { name }
  cycle { name startsAt endsAt }
`;

const ASSIGNED_ISSUES_QUERY = `
  query {
    viewer {
      assignedIssues(
        filter: { state: { type: { nin: ["completed", "canceled"] } } }
        first: 50
        orderBy: updatedAt
      ) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  }
`;

const CREATED_ISSUES_QUERY = `
  query($userId: ID!) {
    issues(
      filter: {
        creator: { id: { eq: $userId } }
        state: { type: { nin: ["completed", "canceled"] } }
      }
      first: 30
      orderBy: updatedAt
    ) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const TEAM_CYCLE_QUERY = `
  query {
    viewer {
      teams {
        nodes {
          name
          activeCycle {
            name
            issues(
              filter: { state: { type: { nin: ["completed", "canceled"] } } }
              first: 30
            ) {
              nodes { ${ISSUE_FIELDS} }
            }
          }
        }
      }
    }
  }
`;

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  priority: number;
  priorityLabel: string;
  estimate?: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  state: { name: string; type: string };
  assignee?: { id: string; name: string };
  labels: { nodes: Array<{ name: string }> };
  project?: { name: string };
  cycle?: { name: string; startsAt: string; endsAt: string };
}

interface ViewerIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: LinearIssue[];
    };
  };
}

interface TeamsResponse {
  viewer: {
    teams: {
      nodes: Array<{
        name: string;
        activeCycle?: {
          name: string;
          issues: { nodes: LinearIssue[] };
        };
      }>;
    };
  };
}
