import { createInterface } from "readline/promises";
import { envFilePath, upsertLocalEnv } from "./env";
import {
  MODEL_NAME,
  MODEL_FILE,
  MODEL_SIZE_MB,
  modelExists,
  modelPath,
  downloadModel,
} from "./ai/local";

// ── display helpers ────────────────────────────────────────────────────────

function hr() {
  console.log("─".repeat(60));
}

function section(title: string) {
  console.log("");
  hr();
  console.log(`  ${title}`);
  hr();
}

function ok(msg: string) { console.log(`  [ok]     ${msg}`); }
function warn(msg: string) { console.log(`  [!]      ${msg}`); }
function info(msg: string) { console.log(`  ${msg}`); }

function progressBar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

async function yesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes: boolean
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (
    await rl.question(`\n  ${question} ${hint} `)
  ).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string
): Promise<string> {
  return (await rl.question(`\n  ${question} `)).trim();
}

// ── sections ───────────────────────────────────────────────────────────────

async function setupGitHub(rl: ReturnType<typeof createInterface>): Promise<void> {
  section("GitHub");

  if (process.env.GITHUB_TOKEN) {
    ok("GITHUB_TOKEN is already configured.");
    const replace = await yesNo(rl, "Replace it?", false);
    if (!replace) return;
  } else {
    const configure = await yesNo(rl, "Configure GitHub now?", true);
    if (!configure) { info("  Skipped."); return; }
  }

  info("");
  info("  1. Go to github.com/settings/tokens → Generate new token (classic)");
  info("  2. Name it 'Workweave' and set an expiration");
  info("  3. Select scope: repo");
  info("  4. Click Generate token and copy it");
  const token = await ask(rl, "Paste GITHUB_TOKEN (input is visible):");
  if (!token) { warn("No token entered — skipping."); return; }
  const file = upsertLocalEnv("GITHUB_TOKEN", token);
  ok(`GITHUB_TOKEN saved to ${file}`);
}

async function setupLocalModel(
  rl: ReturnType<typeof createInterface>
): Promise<boolean> {
  section("AI synthesis  —  local model  (recommended)");

  if (modelExists()) {
    ok(`${MODEL_NAME} is already downloaded.`);
    info(`  Path: ${modelPath()}`);
    const replace = await yesNo(rl, "Re-download it?", false);
    if (!replace) return true;
  } else {
    info(`  Model : ${MODEL_NAME} Q4_K_M`);
    info(`  Size  : ~${MODEL_SIZE_MB} MB  (downloaded once, stored in ~/.workweave/models/)`);
    info(`  Speed : ~5–15 s per synthesis on CPU`);
    info(`  Key   : none required`);

    const go = await yesNo(rl, "Download and use the local model?", true);
    if (!go) return false;
  }

  info("");
  info(`  Downloading ${MODEL_FILE} …`);
  info("");

  let lastLine = "";

  await downloadModel((downloadedMB, totalMB, pct) => {
    const bar = progressBar(pct);
    const line = `  ${bar} ${pct}%  ${downloadedMB} MB / ${totalMB} MB`;
    process.stdout.write("\r" + line + " ".repeat(Math.max(0, lastLine.length - line.length)));
    lastLine = line;
  });

  process.stdout.write("\n");
  info("");
  ok(`Downloaded to ${modelPath()}`);

  return true;
}

async function setupAPIProvider(
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  section("AI synthesis  —  API key  (alternative)");

  info("  Use an API key instead of (or alongside) the local model.");
  info("  The local model is preferred at runtime; an API key is a fallback.");
  info("");

  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic) {
    ok("ANTHROPIC_API_KEY is already configured.");
    const replace = await yesNo(rl, "Replace it?", false);
    if (replace) await enterKey(rl, "anthropic");
  } else if (hasOpenAI) {
    ok("OPENAI_API_KEY is already configured.");
    const replace = await yesNo(rl, "Replace it or add an Anthropic key?", false);
    if (replace) await pickAndEnterKey(rl);
  } else {
    const configure = await yesNo(rl, "Add an API key now?", false);
    if (configure) await pickAndEnterKey(rl);
    else info("  Skipped. Run `workweave setup` again to add one later.");
  }
}

async function pickAndEnterKey(
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  info("");
  info("  1) Anthropic  (claude-haiku-4-5)");
  info("  2) OpenAI     (gpt-4o-mini)");
  const choice = (await rl.question("\n  Enter 1 or 2 [1]: ")).trim();
  await enterKey(rl, choice === "2" ? "openai" : "anthropic");
}

async function enterKey(
  rl: ReturnType<typeof createInterface>,
  provider: "anthropic" | "openai"
): Promise<void> {
  if (provider === "anthropic") {
    info("");
    info("  Get a key at https://console.anthropic.com/settings/keys");
    const key = await ask(rl, "Paste ANTHROPIC_API_KEY (input is visible):");
    if (!key) { warn("No key entered — skipping."); return; }
    const file = upsertLocalEnv("ANTHROPIC_API_KEY", key);
    ok(`ANTHROPIC_API_KEY saved to ${file}`);
  } else {
    info("");
    info("  Get a key at https://platform.openai.com/api-keys");
    const key = await ask(rl, "Paste OPENAI_API_KEY (input is visible):");
    if (!key) { warn("No key entered — skipping."); return; }
    const file = upsertLocalEnv("OPENAI_API_KEY", key);
    ok(`OPENAI_API_KEY saved to ${file}`);
  }
}

async function setupLinear(rl: ReturnType<typeof createInterface>): Promise<void> {
  section("Linear  (optional)");

  if (process.env.LINEAR_API_KEY) {
    ok("LINEAR_API_KEY is already configured.");
    const replace = await yesNo(rl, "Replace it?", false);
    if (!replace) return;
  } else {
    const configure = await yesNo(rl, "Configure Linear now?", false);
    if (!configure) { info("  Skipped."); return; }
  }

  info("");
  info("  Generate a personal API key at:");
  info("    https://linear.app/settings/api");
  const key = await ask(rl, "Paste LINEAR_API_KEY (input is visible):");
  if (!key) { warn("No key entered — skipping."); return; }
  const file = upsertLocalEnv("LINEAR_API_KEY", key);
  ok(`LINEAR_API_KEY saved to ${file}`);
}

async function setupWorkdayHours(rl: ReturnType<typeof createInterface>): Promise<void> {
  section("Workday hours");

  const current = process.env.WORKDAY_MINUTES
    ? `${Math.round(Number(process.env.WORKDAY_MINUTES) / 60)} hours`
    : null;

  if (current) {
    ok(`Workday is currently set to ${current}.`);
    const replace = await yesNo(rl, "Change it?", false);
    if (!replace) return;
  }

  info("  How many hours do you work per day?");
  const input = await ask(rl, "Hours per day [8]:");
  const hours = parseFloat(input || "8");

  if (isNaN(hours) || hours <= 0 || hours > 24) {
    warn("Invalid value — keeping default of 8 hours.");
    return;
  }

  const minutes = Math.round(hours * 60);
  const file = upsertLocalEnv("WORKDAY_MINUTES", String(minutes));
  ok(`Workday set to ${hours}h (${minutes} min), saved to ${file}`);
}

async function setupSlack(rl: ReturnType<typeof createInterface>): Promise<void> {
  section("Slack  (optional)");

  if (process.env.SLACK_USER_TOKEN) {
    ok("SLACK_USER_TOKEN is already configured.");
    const replace = await yesNo(rl, "Replace it?", false);
    if (!replace) return;
  } else {
    const configure = await yesNo(rl, "Configure Slack now?", false);
    if (!configure) { info("  Skipped."); return; }
  }

  info("");
  info("  1. Go to api.slack.com/apps → Create New App → From scratch");
  info("  2. Name it (e.g. 'Workweave') and pick your workspace");
  info("  3. Sidebar: OAuth & Permissions → User Token Scopes → add:");
  info("       search:read  users:read  channels:read  groups:read  im:read");
  info("  4. Scroll up → Install to Workspace → Authorize");
  info("  5. Copy the User OAuth Token  (starts with xoxp-)");

  const token = await ask(rl, "Paste SLACK_USER_TOKEN (input is visible):");
  if (!token) { warn("No token entered — skipping."); return; }
  const file = upsertLocalEnv("SLACK_USER_TOKEN", token);
  ok(`SLACK_USER_TOKEN saved to ${file}`);
}

function printNextSteps(): void {
  section("Done");
  info("Local config: " + envFilePath());
  info("");
  info("  Try it out:");
  info("    workweave detect --connectors github,linear,slack");
  info("    workweave synth  --connectors github --ai");
  info("");
  info("  Run setup again any time to add or update credentials:");
  info("    workweave setup");
  info("");
}

// ── entrypoint ─────────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("");
    hr();
    console.log("  Workweave — setup");
    hr();
    info("");
    info("  Configures connectors and AI synthesis.");
    info("  Credentials are stored in a local .env file (never committed).");

    await setupGitHub(rl);
    const hasLocal = await setupLocalModel(rl);
    if (!hasLocal) {
      // Only prompt for an API key if they declined the local model
      await setupAPIProvider(rl);
    } else {
      // Still offer an API key as an optional fallback
      const addKey = await yesNo(rl, "\n  Also add an API key as fallback?", false);
      if (addKey) await pickAndEnterKey(rl);
    }
    await setupWorkdayHours(rl);
    await setupLinear(rl);
    await setupSlack(rl);

    printNextSteps();
  } finally {
    rl.close();
  }
}
