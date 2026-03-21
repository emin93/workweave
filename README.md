# Workday Synthesizer

A Cursor / VS Code extension that synthesizes your workday from scattered developer signals into a focused, prioritized plan with one-click execution.

## The Problem

Developers lose 30–60 minutes every morning context-switching between Slack, issue trackers, GitHub, and meeting notes to figure out what needs attention. Even after identifying tasks, there's friction in starting them — finding the right repo, checking out branches, loading context.

## What It Does

- **Ingests signals** from GitHub, Linear, and more
- **Normalizes and correlates** related items across tools
- **Prioritizes** using weighted signals (urgency, importance, social pressure, staleness, blocking factor)
- **Schedules** tasks into your configured workday
- **Provides one-click execution** — Plan, Review, Open, Done, Snooze

## Quick Start

### Prerequisites

- [Cursor](https://cursor.com) or VS Code 1.85+
- [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`)
- (Optional) [Linear Connect](https://marketplace.visualstudio.com/items?itemName=linear.linear-connect) extension

### Install & Run

```bash
# Clone and install
git clone <repo-url>
cd workday-synthesizer
pnpm install
cd webview && npm install && cd ..

# Build
pnpm run build

# Launch in Cursor/VS Code
# Press F5 or use "Run Extension" from the debug panel
```

### First Use

1. Open the **Workday Synthesizer** panel from the activity bar (calendar icon)
2. Follow the onboarding wizard to detect and configure your connectors
3. Click **Synthesize My Day** or run `Workday: Synthesize My Day` from the command palette

## Architecture

```
Extension Host (TypeScript)
├── Connectors (GitHub CLI, Linear API)
├── Pipeline (Normalize → Correlate → Prioritize → Schedule)
├── Execution Engine (Plan, Review, Open URL, Done, Snooze)
├── Storage (VS Code globalState + secrets)
└── Onboarding Manager

Webview (React + Tailwind)
├── Onboarding Wizard
├── Workday Plan View
├── Task Cards with Action Buttons
└── Settings View
```

## Commands

| Command | Description |
|---------|-------------|
| `Workday: Synthesize My Day` | Fetch signals and generate today's plan |
| `Workday: Open Settings` | Open the settings view |
| `Workday: Reset Onboarding` | Re-run the setup wizard |

## Connectors

| Source | Method | What It Fetches |
|--------|--------|----------------|
| **GitHub** | `gh` CLI | Assigned PRs, review requests, assigned issues |
| **Linear** | Auth provider + REST | Assigned issues, active cycle items |

## Task Actions

| Action | What It Does |
|--------|-------------|
| **Plan** | Opens Cursor chat with a generated planning prompt |
| **Review** | Checks out the PR branch and opens a review prompt |
| **Open** | Opens the source URL in your browser |
| **Done** | Marks the task as completed |
| **Snooze** | Hides the task for 2 hours |

## Project Structure

```
workday-synthesizer/
  src/
    extension.ts              # Entry point
    connectors/               # GitHub, Linear connectors
    pipeline/                 # Ingest, normalize, correlate, prioritize, schedule
    execution/                # Action handlers and prompt templates
    storage/                  # Local storage abstraction
    onboarding/               # Environment detection and wizard
    types/                    # Shared TypeScript types
    webview/                  # Sidebar webview provider
  webview/
    src/
      components/             # React UI components
      stores/                 # Zustand state management
      hooks/                  # VS Code bridge hooks
      styles/                 # Tailwind CSS
```

## Tech Stack

- **Extension**: TypeScript, esbuild
- **Webview**: React 18, Tailwind CSS, Zustand, Lucide icons
- **Build**: esbuild (extension), Vite (webview)
- **Storage**: VS Code globalState, secrets API

## Development

```bash
# Watch mode (extension + webview)
pnpm run dev

# Build only extension
pnpm run build:extension

# Build only webview
pnpm run build:webview
```

## License

MIT
