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
import { OpenAIProvider, OllamaProvider, type LLMProvider } from "./ai/provider";

interface CliOptions {
  command: "detect" | "synth";
  connectors: string[];
  workdayMinutes: number;
  ai: "none" | "openai" | "ollama";
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const command = (args.shift() as CliOptions["command"] | undefined) ?? "synth";

  const opts: CliOptions = {
    command,
    connectors: ["github"],
    workdayMinutes: 480,
    ai: "none",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--connectors") opts.connectors = (args[++i] ?? "github").split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--workday-minutes") opts.workdayMinutes = Number(args[++i] ?? "480");
    else if (a === "--ai") opts.ai = ((args[++i] ?? "none") as CliOptions["ai"]);
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
  workday detect [--connectors github,linear,slack]
  workday synth [--connectors github,linear,slack] [--workday-minutes 480] [--ai none|openai|ollama]

Environment variables:
  LINEAR_API_KEY          Linear personal API key (for linear connector)
  SLACK_USER_TOKEN        Slack user token xoxp-... (for slack connector)
  OPENAI_API_KEY          API key when --ai openai
  OPENAI_BASE_URL         Optional OpenAI-compatible base URL
  OPENAI_MODEL            Optional model (default: gpt-4o-mini)
  OLLAMA_BASE_URL         Optional (default: http://localhost:11434)
  OLLAMA_MODEL            Optional model (default: llama3.2)
`);
}

function buildRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register(new GitHubConnector());
  registry.register(new LinearConnector());
  registry.register(new SlackConnector());
  return registry;
}

async function resolveProvider(ai: CliOptions["ai"]): Promise<LLMProvider | null> {
  if (ai === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required when --ai openai");
    return new OpenAIProvider({
      apiKey: key,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
    });
  }

  if (ai === "ollama") {
    return new OllamaProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
    });
  }

  return null;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (!["detect", "synth"].includes(opts.command)) {
    printHelp();
    process.exit(1);
  }

  const registry = buildRegistry();

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
  plan.synthesisProvider = provider?.id as "openai" | "ollama" | undefined;

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
