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
