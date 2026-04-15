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
import { OpenAIProvider, AnthropicProvider, LlamaCppProvider, type LLMProvider } from "./ai/provider";
import { modelExists, modelPath } from "./ai/local";
import { loadLocalEnv } from "./env";
import { runSetup } from "./setup";

interface CliOptions {
  command: "detect" | "setup" | "synth";
  connectors: string[];
  workdayMinutes: number;
  ai: boolean;
  provider?: "openai" | "anthropic" | "local";
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
    else if (a === "--provider") {
      const val = args[++i] ?? "";
      if (val === "openai" || val === "anthropic" || val === "local") opts.provider = val;
    }
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
  workday synth [--connectors github,linear,slack] [--workday-minutes 480] [--ai] [--provider local|anthropic|openai]

Environment variables:
  ANTHROPIC_API_KEY       Anthropic API key (fallback when local model is unavailable)
  ANTHROPIC_MODEL         Optional model override (default: claude-haiku-4-5)
  OPENAI_API_KEY          OpenAI API key (fallback when local model and Anthropic are unavailable)
  OPENAI_MODEL            Optional model override (default: gpt-4o-mini)
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

async function resolveProvider(
  useAi: boolean,
  preferredProvider?: "openai" | "anthropic" | "local"
): Promise<LLMProvider | null> {
  if (!useAi) return null;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Explicit --provider flag takes precedence
  if (preferredProvider === "local") {
    if (!modelExists()) {
      throw new Error(
        "Local model not found. Run `workday setup` to download it."
      );
    }
    return new LlamaCppProvider(modelPath());
  }

  if (preferredProvider === "anthropic") {
    if (!anthropicKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is required when --provider anthropic is set. Run `workday setup` first."
      );
    }
    return new AnthropicProvider({ apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL });
  }

  if (preferredProvider === "openai") {
    if (!openaiKey) {
      throw new Error(
        "OPENAI_API_KEY is required when --provider openai is set. Run `workday setup` first."
      );
    }
    return new OpenAIProvider({ apiKey: openaiKey, model: process.env.OPENAI_MODEL });
  }

  // Auto-detect: local model → Anthropic → OpenAI
  if (modelExists()) {
    return new LlamaCppProvider(modelPath());
  }

  if (anthropicKey) {
    return new AnthropicProvider({ apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL });
  }

  if (openaiKey) {
    return new OpenAIProvider({ apiKey: openaiKey, model: process.env.OPENAI_MODEL });
  }

  throw new Error(
    "No AI provider found. Run `workday setup` to download a local model or add an API key."
  );
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
    await runSetup();
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

  const provider = await resolveProvider(opts.ai, opts.provider);
  let clusters;
  let synthesisMode: "ai" | "rules" = "rules";

  if (provider) {
    const out = await aiSynthesize(artifacts, provider, {
      info: (msg) => process.stderr.write(`[info] ${msg}\n`),
      warn: (msg) => process.stderr.write(`[warn] ${msg}\n`),
    });
    clusters = out.clusters;
    synthesisMode = out.mode;
  } else {
    clusters = prioritize(correlate(artifacts));
  }

  const plan = schedule(clusters, opts.workdayMinutes);
  plan.synthesisMode = synthesisMode;
  plan.synthesisProvider = provider?.id as "openai" | "anthropic" | "local" | undefined;

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
