# Workday Synthesizer

> Turn scattered developer signals into a focused, prioritized plan for your day.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/badge/version-0.2.0-blue.svg)](package.json)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Workday Synthesizer is a CLI tool that ingests activity from **GitHub**, **Linear**, and **Slack**, then synthesizes a time-boxed workday plan — either using deterministic prioritization rules or an AI model of your choice (local, Anthropic, or OpenAI).

---

## How it works

```
GitHub ─┐
Linear ─┼──▶  ingest ──▶  normalize ──▶  correlate ──▶  prioritize ──▶  schedule ──▶  plan
Slack  ─┘                                                      ▲
                                                         (optional AI)
```

1. **Ingest** — pull open PRs, assigned issues, mentions, and messages
2. **Normalize** — map everything to a common `Artifact` model
3. **Correlate** — link related items across sources
4. **Prioritize** — score by urgency, importance, social pressure, staleness, and blocking factors
5. **Schedule** — fit clusters into your available workday budget
6. **Display** — rich terminal output or machine-readable JSON

---

## Features

- **Three AI providers** — local model (no key required), Anthropic Claude, or OpenAI
- **Rules mode** — works fully offline, no API key needed
- **JSON output** — pipe into scripts, dashboards, or other tools with `--json`
- **Interactive setup** — guided `workday setup` wizard configures everything
- **Connector detection** — `workday detect` checks which sources are ready before you run
- **Configurable workday budget** — schedule work to fit your actual available hours

---

## Install

```bash
git clone https://github.com/emin93/workday-synthesizer.git
cd workday-synthesizer
npm install
npm run build
```

To use the `workday` command globally:

```bash
npm link
```

Or run directly without linking:

```bash
node dist/cli.js <command>
```

---

## Quick start

**1. Run the interactive setup wizard:**

```bash
workday setup
```

The wizard walks you through:
- GitHub personal access token (repo scope)
- AI provider — downloads a local model (~4 GB, runs on CPU) or configures an API key
- Workday hours (default: 8 h)
- Linear API key (optional)
- Slack user token (optional)

All credentials are stored in a local `.env` file that is never committed.

**2. Check that your connectors are ready:**

```bash
workday detect --connectors github,linear,slack
```

**3. Synthesize your day:**

```bash
workday synth --connectors github,linear,slack
```

---

## Commands

### `workday setup`

Interactive wizard to configure connectors and AI.

```bash
workday setup
```

### `workday detect`

Check which connectors are configured and reachable.

```bash
workday detect --connectors github,linear,slack
```

```
  github   ✓  authenticated as emin93
  linear   ✓  workspace: Acme Corp
  slack    ✗  SLACK_USER_TOKEN not set
```

### `workday synth`

Fetch signals and produce a workday plan.

```bash
# Rules-based (no AI, works offline)
workday synth --connectors github,linear

# With AI — auto-detects provider (local → Anthropic → OpenAI)
workday synth --connectors github,linear,slack --ai

# Force a specific provider
workday synth --connectors github --ai --provider anthropic

# Adjust available time
workday synth --connectors github --workday-minutes 360

# Machine-readable output
workday synth --connectors github --ai --json
```

---

## AI providers

Workday Synthesizer supports three AI backends. When `--ai` is set and no `--provider` is specified, it auto-detects in this order:

| Priority | Provider | How to configure |
|----------|----------|-----------------|
| 1 | **Local model** (Llama, via `node-llama-cpp`) | Run `workday setup` to download (~4 GB, CPU-only, no key) |
| 2 | **Anthropic** (`claude-haiku-4-5`) | Set `ANTHROPIC_API_KEY` |
| 3 | **OpenAI** (`gpt-4o-mini`) | Set `OPENAI_API_KEY` |

You can force a provider with `--provider local|anthropic|openai`.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token (repo scope) |
| `LINEAR_API_KEY` | Linear personal API key |
| `SLACK_USER_TOKEN` | Slack user token (`xoxp-…`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | Model override (default: `claude-haiku-4-5`) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model override (default: `gpt-4o-mini`) |
| `WORKDAY_MINUTES` | Available minutes per day (default: `480`) |

Variables can be set in a local `.env` file at the project root (created by `workday setup`) or exported in your shell.

---

## JSON output

Add `--json` to any command for machine-readable output. Progress logs are suppressed and only the result is written to stdout.

```bash
workday synth --connectors github --json | jq '.plan.blocks[].title'
```

**`synth` output shape:**

```jsonc
{
  "plan": {
    "blocks": [...],           // scheduled work blocks
    "synthesisMode": "ai",     // "ai" | "rules"
    "synthesisProvider": "local"
  },
  "meta": {
    "connectors": ["github"],
    "rawEvents": 42,           // raw events ingested
    "artifacts": 18,           // normalized artifacts
    "connectorErrors": []      // non-fatal errors
  }
}
```

**`detect` output shape:**

```jsonc
{
  "connectors": [
    { "id": "github", "ready": true, "detail": "authenticated as emin93" },
    { "id": "linear", "ready": false, "detail": "LINEAR_API_KEY not set" }
  ]
}
```

---

## Project structure

```
src/
  cli.ts                  # CLI entry point, argument parsing
  setup.ts                # Interactive setup wizard
  display.ts              # Terminal rendering (plan, detect, spinner)
  env.ts                  # .env file loading and writing
  connectors/
    github.ts             # GitHub REST API connector
    linear.ts             # Linear GraphQL connector
    slack.ts              # Slack Web API connector
    registry.ts           # Connector registry + detect-all
  pipeline/
    ingest.ts             # Orchestrate connector fetching
    normalize.ts          # Map raw events → Artifact
    correlate.ts          # Link related artifacts across sources
    prioritize.ts         # Score and rank clusters
    schedule.ts           # Fit clusters into workday budget
    ai-synthesize.ts      # AI-powered clustering and titling
  ai/
    provider.ts           # LLMProvider interface + OpenAI/Anthropic/LlamaCpp impls
    local.ts              # Local model path helpers and download
  types/                  # Shared TypeScript models
```

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a PR.

```bash
npm run build   # compile TypeScript
npm run lint    # ESLint
```

---

## License

[MIT](LICENSE)
