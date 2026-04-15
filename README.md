# Workday Synthesizer (CLI)

Workday Synthesizer is now a **CLI-first tool** that turns scattered developer signals into a focused, prioritized plan for your day.

## Why CLI-first

- decoupled from fast-changing IDE extension APIs
- reusable in terminal workflows, scripts, and automation
- easier to test and evolve as a standalone planning engine

## What it does

- Ingests signals from GitHub, Linear, and Slack
- Normalizes + correlates related items
- Prioritizes with urgency / importance / social pressure / staleness / blocking factors
- Schedules work into your workday budget
- Optionally uses AI (OpenAI-compatible or Ollama) for clustering/titling/prioritization

## Install

```bash
npm install
npm run build
```

Run from source:

```bash
npm run dev -- synth --connectors github
```

Run built CLI:

```bash
node dist/cli.js synth --connectors github
```

## Commands

### Detect connector readiness

```bash
node dist/cli.js detect --connectors github,linear,slack
```

### Synthesize a workday plan (rules)

```bash
node dist/cli.js synth --connectors github,linear,slack --workday-minutes 480
```

### Synthesize with AI

```bash
OPENAI_API_KEY=... node dist/cli.js synth --connectors github,linear --ai openai
# or
node dist/cli.js synth --connectors github --ai ollama
```

## Environment variables

- `LINEAR_API_KEY`: Linear personal API key (for Linear connector)
- `SLACK_USER_TOKEN`: Slack user token (for Slack connector)
- `OPENAI_API_KEY`: required for `--ai openai`
- `OPENAI_BASE_URL`: optional OpenAI-compatible endpoint
- `OPENAI_MODEL`: optional model override
- `OLLAMA_BASE_URL`: optional (default `http://localhost:11434`)
- `OLLAMA_MODEL`: optional model override

## JSON output

`workday synth` prints machine-readable JSON:

- `plan`: synthesized `WorkdayPlan`
- `meta.rawEvents`: ingested raw events count
- `meta.artifacts`: normalized artifacts count
- `meta.connectorErrors`: non-fatal connector errors

## Project structure

```
src/
  cli.ts                    # command entrypoint
  connectors/               # github/linear/slack connectors
  pipeline/                 # ingest, normalize, correlate, prioritize, schedule, ai-synthesize
  ai/                       # OpenAI/Ollama providers
  types/                    # shared models
```

## License

MIT
