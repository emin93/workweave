import * as https from "https";
import * as http from "http";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface LLMProvider {
  id: string;
  name: string;
  complete(prompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
}

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "API";

  constructor(private config: OpenAIConfig) {}

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async complete(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com";
    const model = this.config.model || "gpt-4o-mini";
    const url = new URL("/v1/chat/completions", baseUrl);

    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    return httpRequest({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      protocol: url.protocol,
      body,
      timeoutMs: 30_000,
    }).then((raw) => {
      const parsed = JSON.parse(raw);
      return parsed.choices?.[0]?.message?.content ?? "";
    });
  }
}

export class OllamaProvider implements LLMProvider {
  id = "ollama";
  name = "Ollama";

  constructor(private config: OllamaConfig = {}) {}

  async isAvailable(): Promise<boolean> {
    try {
      const baseUrl = this.config.baseUrl || "http://localhost:11434";
      const url = new URL("/api/tags", baseUrl);
      await httpRequest({
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method: "GET",
        headers: {},
        protocol: url.protocol,
        timeoutMs: 3_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async complete(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";
    const model = this.config.model || "llama3.2";
    const url = new URL("/api/generate", baseUrl);

    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
    });

    return httpRequest({
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      protocol: url.protocol,
      body,
      timeoutMs: 60_000,
    }).then((raw) => {
      const parsed = JSON.parse(raw);
      return parsed.response ?? "";
    });
  }
}

export class CursorChatProvider implements LLMProvider {
  id = "cursor";
  name = "Cursor";

  private workdayDir: string;

  constructor(workspacePath: string) {
    this.workdayDir = path.join(workspacePath, ".workday");
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(prompt: string): Promise<string> {
    await fs.promises.mkdir(this.workdayDir, { recursive: true });

    const artifactsPath = path.join(this.workdayDir, "artifacts.json");
    const planPath = path.join(this.workdayDir, "plan.json");

    await fs.promises.writeFile(artifactsPath, prompt, "utf-8");

    try {
      await fs.promises.unlink(planPath);
    } catch {
      // file may not exist
    }

    const cursorPrompt = buildCursorPrompt(artifactsPath, planPath);

    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: cursorPrompt,
        isPartialQuery: false,
      });

      await sleep(300);

      try {
        await vscode.commands.executeCommand("workbench.action.chat.submit");
      } catch {
        try {
          await vscode.commands.executeCommand(
            "workbench.action.chat.stopListeningAndSubmit"
          );
        } catch {
          // prompt is at least populated
        }
      }
    } catch {
      throw new Error("Failed to open Cursor chat");
    }

    return waitForFile(planPath, 60_000);
  }
}

function buildCursorPrompt(artifactsPath: string, planPath: string): string {
  const normalized = artifactsPath.replace(/\\/g, "/");
  const planNormalized = planPath.replace(/\\/g, "/");

  return `Read the file at \`${normalized}\` — it contains a JSON array of work items (PRs, issues, Slack messages) from a developer's day.

Synthesize them into a prioritized workday plan and write the result as JSON to \`${planNormalized}\`.

The output JSON must match this schema exactly:
{
  "clusters": [
    {
      "artifactIds": ["id1", "id2"],
      "title": "Human-readable actionable title",
      "summary": "Why this matters, 1 sentence",
      "category": "review|implementation|respond|investigate|follow_up|meeting_prep|other",
      "priorityScore": 75,
      "priorityReasons": ["Due tomorrow", "Blocking release"],
      "estimatedMinutes": 30
    }
  ],
  "reasoning": "Brief explanation of ordering logic"
}

Rules:
- Group related items into clusters (e.g. a Slack message about a PR goes with that PR)
- Write clear actionable titles, not raw identifiers
- Categories: "review" (PR to review), "follow_up" (your own PR), "implementation" (coding task), "investigate" (research/spike), "respond" (reply to message), "meeting_prep", "other"
- Score priority 0-100 based on urgency, importance, social pressure, and impact
- **estimatedMinutes**: assume the developer uses **AI assistants** (Cursor, Copilot). Use short, realistic active-time estimates (e.g. Slack reply 5–15m, PR review 10–35m, implementation chunks 20–55m), not manual end-to-end coding time
- Order to minimize context switching
- Write ONLY the JSON to the file, no markdown fences`;
}

function waitForFile(filePath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);

    const checkExisting = () => {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.trim().length > 0) {
          return content;
        }
      } catch {
        // file doesn't exist yet
      }
      return null;
    };

    const existing = checkExisting();
    if (existing) {
      resolve(existing);
      return;
    }

    const pattern = new vscode.RelativePattern(dir, filename);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const timer = setTimeout(() => {
      watcher.dispose();
      clearInterval(pollInterval);
      reject(new Error("Cursor chat did not produce a plan within the timeout. Check the Cursor chat window."));
    }, timeoutMs);

    const tryRead = () => {
      const content = checkExisting();
      if (content) {
        clearTimeout(timer);
        clearInterval(pollInterval);
        watcher.dispose();
        resolve(content);
      }
    };

    watcher.onDidCreate(tryRead);
    watcher.onDidChange(tryRead);

    const pollInterval = setInterval(tryRead, 2_000);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HttpRequestOptions {
  hostname: string;
  port: number | string;
  path: string;
  method: string;
  headers: Record<string, string>;
  protocol: string;
  body?: string;
  timeoutMs: number;
}

function httpRequest(opts: HttpRequestOptions): Promise<string> {
  const transport = opts.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        method: opts.method,
        headers: {
          ...opts.headers,
          ...(opts.body
            ? { "Content-Length": Buffer.byteLength(opts.body) }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${data.slice(0, 200)}`
              )
            );
          } else {
            resolve(data);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(opts.timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${opts.timeoutMs}ms`));
    });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}
