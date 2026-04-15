#!/usr/bin/env node
import { ConnectorRegistry } from "./connectors/registry";
import { GitHubConnector } from "./connectors/github";
import { LinearConnector } from "./connectors/linear";
import { SlackConnector } from "./connectors/slack";
import { IngestionOrchestrator } from "./pipeline/ingest";
import { normalize } from "./pipeline/normalize";
import { correlate } from "./pipeline/correlate";
import { prioritize } from "./pipeline/prioritize";
import { schedule } from "./pipeline/schedule";
import { aiSynthesize } from "./pipeline/ai-synthesize";
import { OpenAIProvider, type LLMProvider } from "./ai/provider";
import { loadLocalEnv } from "./env";
import { runSetup } from "./setup";

interface CliOptions {
  command: "detect" | "setup" | "synth";
  connectors: string[];
  workdayMinutes: number;
  ai: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const first = args[0];
  const command =
    first === "detect" || first === "setup" || first === "synth"
      ? (args.shift() as CliOptions["command"])
      : "synth";

  const opts: CliOptions = {
    command,
    connectors: ["github"],
    workdayMinutes: 480,
    ai: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--connectors") opts.connectors = (args[++i] ?? "github").split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--workday-minutes") opts.workdayMinutes = Number(args[++i] ?? "480");
    else if (a === "--ai") opts.ai = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Workday Synthesizer CLI

Usage:
  workday setup
  workday detect [--connectors github,linear,slack]
  workday synth [--connectors github,linear,slack] [--workday-minutes 480] [--ai]

Environment variables:
  OPENAI_API_KEY          API key used when --ai is enabled
  OPENAI_MODEL            Optional model (default: gpt-4o-mini)
  LINEAR_API_KEY          Linear personal API key (for linear connector)
  SLACK_USER_TOKEN        Slack user token xoxp-... (for slack connector)
`);
}

function buildRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register(new GitHubConnector());
  registry.register(new LinearConnector());
  registry.register(new SlackConnector());
  return registry;
}

async function resolveProvider(useAi: boolean): Promise<LLMProvider | null> {
  if (!useAi) return null;

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is required when --ai is enabled. Run `workday setup` first."
    );
  }

  return new OpenAIProvider({
    apiKey: key,
    model: process.env.OPENAI_MODEL,
  });
}

loadLocalEnv();

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!["detect", "setup", "synth"].includes(opts.command)) {
    printHelp();
    process.exit(1);
  }

  const registry = buildRegistry();

  if (opts.command === "setup") {
    await runSetup(registry);
    return;
  }

  if (opts.command === "detect") {
    const infos = await registry.detectAll();
    console.log(JSON.stringify({ connectors: infos }, null, 2));
    return;
  }

  const ingestion = new IngestionOrchestrator(registry);
  const { events, errors } = await ingestion.fetchAll(opts.connectors);
  const artifacts = normalize(events);

  const provider = await resolveProvider(opts.ai);
  let clusters;
  let synthesisMode: "ai" | "rules" = "rules";

  if (provider) {
    const out = await aiSynthesize(artifacts, provider);
    clusters = out.clusters;
    synthesisMode = out.mode;
  } else {
    clusters = prioritize(correlate(artifacts));
  }

  const plan = schedule(clusters, opts.workdayMinutes);
  plan.synthesisMode = synthesisMode;
  plan.synthesisProvider = provider?.id as "openai" | undefined;

  console.log(
    JSON.stringify(
      {
        plan,
        meta: {
          connectors: opts.connectors,
          rawEvents: events.length,
          artifacts: artifacts.length,
          connectorErrors: errors,
        },
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
