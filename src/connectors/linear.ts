import * as vscode from "vscode";
import type {
  Connector,
  ConnectorStatus,
  ConnectorCapability,
  RawEvent,
} from "../types";
import * as https from "https";

const LINEAR_API = "https://api.linear.app/graphql";

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
              reject(
                new Error(parsed.errors[0]?.message ?? "Linear API error")
              );
            } else {
              resolve(parsed.data as T);
            }
          } catch {
            reject(new Error(`Failed to parse Linear response (HTTP ${res.statusCode})`));
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
      // First try silently (don't prompt if no session exists yet)
      let session = await vscode.authentication.getSession(
        "linear",
        ["read"],
        { silent: true }
      );

      if (!session) {
        // No existing session -- prompt the user to sign in
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
      // User may have dismissed the auth prompt -- that's not a hard error
      if (!msg.includes("User did not consent")) {
        throw new Error(`Linear authentication failed: ${msg}`);
      }
    }
    return false;
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      { type: "issue", description: "Issues assigned to you in Linear" },
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
    const now = new Date().toISOString();

    const data = await linearQuery<LinearIssuesResponse>(
      this._token!,
      ASSIGNED_ISSUES_QUERY
    );
    const issues = data.viewer?.assignedIssues?.nodes ?? [];

    for (const issue of issues) {
      events.push({
        id: `linear-issue-${issue.identifier}`,
        connectorId: this.id,
        sourceType: "issue",
        rawPayload: issue,
        fetchedAt: now,
      });
    }

    return events;
  }
}

const ASSIGNED_ISSUES_QUERY = `
  query {
    viewer {
      assignedIssues(
        filter: {
          state: { type: { nin: ["completed", "canceled"] } }
        }
        first: 50
        orderBy: updatedAt
      ) {
        nodes {
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
          state {
            name
            type
          }
          labels {
            nodes {
              name
            }
          }
          project {
            name
          }
          cycle {
            name
            startsAt
            endsAt
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
  labels: { nodes: Array<{ name: string }> };
  project?: { name: string };
  cycle?: { name: string; startsAt: string; endsAt: string };
}

interface LinearIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: LinearIssue[];
    };
  };
}
