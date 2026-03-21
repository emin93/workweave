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
          Authorization: token,
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
              reject(new Error(parsed.errors[0]?.message ?? "Linear API error"));
            } else {
              resolve(parsed.data as T);
            }
          } catch {
            reject(new Error("Failed to parse Linear response"));
          }
        });
      }
    );
    req.on("error", reject);
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
      setupInstructions:
        "Install the 'Linear Connect' extension from the VS Code marketplace",
    };
  }

  async authenticate(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession(
        "linear",
        ["read"],
        { createIfNone: true }
      );
      if (session) {
        this._token = session.accessToken;
        return true;
      }
    } catch {
      // Auth failed
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
      if (!ok) return [];
    }

    const events: RawEvent[] = [];
    const now = new Date().toISOString();

    try {
      const data = await linearQuery<LinearIssuesResponse>(this._token!, ASSIGNED_ISSUES_QUERY);
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
    } catch {
      // Silently skip
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
