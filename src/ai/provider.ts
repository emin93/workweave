import * as https from "https";
import * as http from "http";

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
  name = "OpenAI-compatible API";

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

    const body = JSON.stringify({ model, prompt, stream: false, format: "json" });

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
