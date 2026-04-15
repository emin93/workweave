import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from "fs";
import * as https from "https";
import * as http from "http";

export const MODEL_NAME = "Qwen2.5-1.5B-Instruct";
export const MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
export const MODEL_SIZE_MB = 986;

const HF_URL =
  "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/" +
  MODEL_FILE;

export function modelsDir(): string {
  return join(homedir(), ".workweave", "models");
}

export function modelPath(): string {
  return join(modelsDir(), MODEL_FILE);
}

export function modelExists(): boolean {
  return existsSync(modelPath());
}

export type ProgressCallback = (
  downloadedMB: number,
  totalMB: number,
  pct: number
) => void;

export function downloadModel(onProgress: ProgressCallback): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = modelsDir();
    mkdirSync(dir, { recursive: true });

    const dest = modelPath();
    const tmp = dest + ".part";

    function doRequest(url: string, redirects = 0): void {
      if (redirects > 10) {
        reject(new Error("Too many redirects"));
        return;
      }

      const parsed = new URL(url);
      const transport = parsed.protocol === "https:" ? https : http;

      transport
        .get(
          url,
          { headers: { "User-Agent": "workweave/1.0" } },
          (res) => {
            const { statusCode, headers: resHeaders } = res;

            if (
              statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 307 ||
              statusCode === 308
            ) {
              res.resume();
              doRequest(resHeaders.location!, redirects + 1);
              return;
            }

            if (statusCode !== 200) {
              res.resume();
              reject(new Error(`Download failed: HTTP ${statusCode}`));
              return;
            }

            const totalBytes = parseInt(
              resHeaders["content-length"] ?? "0",
              10
            );
            const totalMB = totalBytes
              ? Math.round(totalBytes / 1024 / 1024)
              : MODEL_SIZE_MB;
            let downloaded = 0;

            const ws = createWriteStream(tmp);

            res.on("data", (chunk: Buffer) => {
              downloaded += chunk.length;
              ws.write(chunk);
              const downloadedMB = Math.round(downloaded / 1024 / 1024);
              const pct = totalBytes
                ? Math.round((downloaded / totalBytes) * 100)
                : 0;
              onProgress(downloadedMB, totalMB, pct);
            });

            res.on("end", () => {
              ws.end(() => {
                // rename .part → final
                const { renameSync } = require("fs") as typeof import("fs");
                try {
                  renameSync(tmp, dest);
                } catch {
                  // cross-device fallback: copy then delete
                  const { copyFileSync } = require("fs") as typeof import("fs");
                  copyFileSync(tmp, dest);
                  unlinkSync(tmp);
                }
                resolve();
              });
            });

            res.on("error", (err) => {
              ws.destroy();
              try { unlinkSync(tmp); } catch { /* ignore */ }
              reject(err);
            });

            ws.on("error", (err) => {
              res.destroy();
              try { unlinkSync(tmp); } catch { /* ignore */ }
              reject(err);
            });
          }
        )
        .on("error", (err) => {
          try { unlinkSync(tmp); } catch { /* ignore */ }
          reject(err);
        });
    }

    doRequest(HF_URL);
  });
}
