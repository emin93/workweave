import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ENV_FILE = ".env";

export function envFilePath(cwd = process.cwd()): string {
  return join(cwd, ENV_FILE);
}

export function loadLocalEnv(cwd = process.cwd()): void {
  const file = envFilePath(cwd);
  if (!existsSync(file)) return;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    let value = normalized.slice(equalsIndex + 1).trim();
    value = stripWrappingQuotes(value);

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function upsertLocalEnv(
  key: string,
  value: string,
  cwd = process.cwd()
): string {
  const file = envFilePath(cwd);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const nextLine = `${key}=${value}`;

  let replaced = false;
  const updated = lines.map((line) => {
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    if (normalized.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (updated.length > 0 && updated[updated.length - 1] !== "") {
      updated.push("");
    }
    updated.push(nextLine);
  }

  writeFileSync(file, `${updated.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
  process.env[key] = value;
  return file;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
