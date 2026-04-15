import * as https from "https";
import * as http from "http";
import { existsSync } from "fs";

export interface LLMProvider {
  id: string;
  name: string;
  complete(prompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "OpenAI API";

  constructor(private config: OpenAIConfig) {}

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async complete(prompt: string): Promise<string> {
    const model = this.config.model || "gpt-4o-mini";
    const url = new URL("/v1/chat/completions", "https://api.openai.com");

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

export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  name = "Anthropic API";

  constructor(private config: AnthropicConfig) {}

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async complete(prompt: string): Promise<string> {
    const model = this.config.model || "claude-haiku-4-5";
    const url = new URL("/v1/messages", "https://api.anthropic.com");

    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    return httpRequest({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      protocol: "https:",
      body,
      timeoutMs: 60_000,
    }).then((raw) => {
      const parsed = JSON.parse(raw);
      const textBlock = (parsed.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((b) => b.type === "text");
      return textBlock?.text ?? "";
    });
  }
}

export class LlamaCppProvider implements LLMProvider {
  id = "local";
  name = "Local model (Qwen2.5-1.5B)";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _llama: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model: any = null;

  constructor(private readonly _modelPath: string) {}

  async isAvailable(): Promise<boolean> {
    return existsSync(this._modelPath);
  }

  private async _load(): Promise<void> {
    if (this._model) return;
    // Dynamic import so the package is only loaded when actually used.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const llama = require("node-llama-cpp");
    this._llama = await llama.getLlama({ gpu: false });
    this._model = await this._llama.loadModel({ modelPath: this._modelPath });
  }

  async complete(prompt: string): Promise<string> {
    await this._load();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LlamaChatSession } = require("node-llama-cpp");
    const context = await this._model.createContext({ contextSize: 4096 });
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });
    const response: string = await session.prompt(prompt);
    await context.dispose();
    return response;
  }
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
          ...(opts.body ? { "Content-Length": Buffer.byteLength(opts.body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
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
