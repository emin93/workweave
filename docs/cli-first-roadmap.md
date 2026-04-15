# CLI-First Roadmap for Workday Synthesizer

## Why shift to CLI-first?

The current extension is already strong on workflow UX, but orchestration and product logic are embedded in the VS Code host process. A CLI-first core would let you:

- Reuse the same synthesizer in VS Code, Cursor, terminal, cron jobs, and future web/mobile clients.
- Improve testability and observability (headless runs, snapshots, fixtures).
- Decouple decision logic from UI/runtime constraints.

## Current state (what already helps)

- Pipeline stages are already modular (`normalize`, `correlate`, `prioritize`, `schedule`, `ai-synthesize`).
- Shared domain types (`Artifact`, `TaskCluster`, `WorkdayPlan`) are explicit and well-defined.
- Connectors are behind a common interface (`detect`, `authenticate`, `fetch`, `getCapabilities`).

This means a clean extraction is very feasible.

## Proposed target architecture

```
apps/
  extension-vscode/        # UI shell + command bridge
  cli/                     # workday synth / sync / explain / act
packages/
  core/                    # pipeline + orchestration + policies
  connectors/              # github/linear/slack adapters (headless-friendly)
  storage/                 # local sqlite/json storage + secrets abstraction
  protocol/                # JSON schemas + typed contracts
```

### Runtime boundary

The extension should become a thin client that shells out to `workday` (or speaks stdio JSON-RPC), then renders returned plans.

## Migration phases

### Phase 1 — Core extraction (no UX change)

- Move synthesis orchestration and pipeline calls from extension host into a `core` package.
- Replace direct `vscode` logging in orchestration with an injectable logger interface.
- Keep existing extension behavior by calling core APIs in-process first.

### Phase 2 — Headless storage + config

- Introduce storage abstraction independent of VS Code `globalState/secrets`.
- Add a file-backed default implementation for CLI (e.g., `~/.workday-synthesizer`).
- Keep a VS Code adapter for backward compatibility.

### Phase 3 — CLI experience

Add commands:

- `workday synth` (full synthesis)
- `workday sync` (incremental update)
- `workday plan --json` (machine-readable)
- `workday explain <cluster-id>` (priority reasons + provenance)
- `workday action <cluster-id> <action-id>`

### Phase 4 — Extension as client

- Extension executes CLI command and parses JSON response.
- Onboarding/settings UI writes config consumed by CLI.
- Preserve current webview and actions with minimal UI changes.

### Phase 5 — Intelligence upgrades

- Add cross-source identity graph (Slack thread ↔ PR ↔ issue)
- Add adaptive prioritization from user feedback (done/snooze/reorder)
- Add deterministic fallback policy packs (team-specific scoring rules)

## Suggested first implementation slice (1-2 weeks)

1. Extract `synthesize` orchestration into pure core service.
2. Introduce `Logger`, `Clock`, `Storage`, and `ConnectorGateway` interfaces.
3. Build `workday synth --json` command returning `WorkdayPlan`.
4. Update extension to call core service directly (temporary) using same interfaces.
5. Add golden-file tests for correlation and prioritization outputs.

## Risks and mitigations

- **Risk:** auth flows currently tied to extension UX.
  - **Mitigation:** keep auth/bootstrap in extension initially; CLI consumes already-issued tokens.
- **Risk:** drift between extension and CLI behavior.
  - **Mitigation:** single core package + contract tests + snapshot fixtures.
- **Risk:** user confusion during migration.
  - **Mitigation:** no visible UX changes until CLI parity is complete.

## Product principle

Keep your differentiation in the synthesis engine and prioritization policy — not in any single client surface.
