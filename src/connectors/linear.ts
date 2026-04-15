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
              reject(new Error(parsed.errors[0]?.message ?? "Linear API error"));
            } else if (!parsed.data) {
              reject(new Error("Linear API returned no data"));
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
    if (!process.env.LINEAR_API_KEY) {
      return {
        available: false,
        reason: "LINEAR_API_KEY is not set",
        setupInstructions:
          "Set LINEAR_API_KEY in your environment with a personal API key from Linear settings.",
      };
    }
    return { available: true, authMethod: "token" };
  }

  async authenticate(): Promise<boolean> {
    this._token = process.env.LINEAR_API_KEY ?? null;
    if (!this._token) return false;
    try {
      await linearQuery(this._token, `query { viewer { id } }`);
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ConnectorCapability[] {
    return [{ type: "issue", description: "Issues assigned to you" }];
  }

  async fetch(): Promise<RawEvent[]> {
    if (!this._token) {
      const ok = await this.authenticate();
      if (!ok) throw new Error("Linear authentication failed");
    }

    const now = new Date().toISOString();
    const assigned = await linearQuery<ViewerIssuesResponse>(
      this._token!,
      ASSIGNED_ISSUES_QUERY
    );

    return (assigned.viewer?.assignedIssues?.nodes ?? []).map((issue) => ({
      id: `linear-issue-${issue.identifier}`,
      connectorId: this.id,
      sourceType: "issue",
      rawPayload: issue,
      fetchedAt: now,
    }));
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

interface ViewerIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: LinearIssue[];
    };
  };
}
