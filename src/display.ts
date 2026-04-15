import type { WorkweavePlan, ConnectorInfo, TaskCluster, TaskCategory } from "./types";

// ── ANSI helpers ───────────────────────────────────────────────────────────

const TTY = process.stdout.isTTY;

function esc(...codes: number[]) {
  return TTY ? `\x1b[${codes.join(";")}m` : "";
}

const c = {
  reset:   esc(0),
  bold:    esc(1),
  dim:     esc(2),
  red:     esc(31),
  green:   esc(32),
  yellow:  esc(33),
  blue:    esc(34),
  magenta: esc(35),
  cyan:    esc(36),
  white:   esc(37),
  bRed:    esc(1, 31),
  bGreen:  esc(1, 32),
  bYellow: esc(1, 33),
  bBlue:   esc(1, 34),
  bCyan:   esc(1, 36),
  bWhite:  esc(1, 37),
};

function styled(color: string, text: string) {
  return `${color}${text}${c.reset}`;
}

// ── spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let _spinnerTimer: ReturnType<typeof setInterval> | null = null;
let _spinnerFrame = 0;

export function startSpinner(msg: string): void {
  if (!process.stderr.isTTY) return;
  _spinnerFrame = 0;
  _spinnerTimer = setInterval(() => {
    const frame = styled(c.cyan, SPINNER_FRAMES[_spinnerFrame % SPINNER_FRAMES.length]);
    process.stderr.write(`\r  ${frame}  ${msg}  `);
    _spinnerFrame++;
  }, 80);
}

export function stopSpinner(): void {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
    if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  }
}

// ── formatting helpers ─────────────────────────────────────────────────────

function hr(width = 64) {
  return styled(c.dim, "─".repeat(width));
}

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min > 0 ? `${min}m` : ""}`.trim() : `${min}m`;
}

function formatSlot(start: number, end: number): string {
  function toHM(m: number) {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    return `${h}:${mm}`;
  }
  return `${toHM(start)}–${toHM(end)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  review:        "REVIEW",
  follow_up:     "FOLLOW UP",
  implementation:"IMPLEMENT",
  respond:       "RESPOND",
  investigate:   "INVESTIGATE",
  meeting_prep:  "MEETING",
  other:         "OTHER",
};

const CATEGORY_COLOR: Record<TaskCategory, string> = {
  review:        c.cyan,
  follow_up:     c.yellow,
  implementation:c.blue,
  respond:       c.green,
  investigate:   c.magenta,
  meeting_prep:  c.yellow,
  other:         c.dim,
};

function categoryBadge(cat: TaskCategory): string {
  const label = CATEGORY_LABEL[cat] ?? cat.toUpperCase();
  const color = CATEGORY_COLOR[cat] ?? c.dim;
  const padded = label.padEnd(11);
  return styled(color, padded);
}

function scoreColor(score: number): string {
  if (score >= 80) return c.bRed;
  if (score >= 60) return c.bYellow;
  if (score >= 40) return c.white;
  return c.dim;
}

function dayBar(used: number, total: number, width = 40): string {
  const pct = Math.min(used / total, 1);
  const filled = Math.round(pct * width);
  const bar = styled(c.blue, "█".repeat(filled)) + styled(c.dim, "░".repeat(width - filled));
  const label = `${formatMinutes(used)} / ${formatMinutes(total)}  (${Math.round(pct * 100)}%)`;
  return `  ${bar}  ${styled(c.dim, label)}`;
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

// ── plan output ────────────────────────────────────────────────────────────

function printCluster(cluster: TaskCluster, index: number): void {
  const slot = cluster.scheduledSlot
    ? styled(c.dim, formatSlot(cluster.scheduledSlot.start, cluster.scheduledSlot.end))
    : styled(c.dim, "backlog   ");

  const badge = categoryBadge(cluster.category);
  const title = styled(c.bold, truncate(cluster.title, 48));
  const score = styled(scoreColor(cluster.priorityScore), String(cluster.priorityScore).padStart(3));
  const num   = styled(c.dim, String(index).padStart(2));

  console.log(`  ${num}  ${slot.padEnd(TTY ? 20 : 11)}  ${badge}  ${title}  ${score}`);

  if (cluster.summary) {
    console.log(`        ${styled(c.dim, truncate(cluster.summary, 60))}`);
  }

  // Collect unique repos / projects
  const contexts = new Set<string>();
  for (const a of cluster.artifacts) {
    const repo = a.metadata.repository as string | undefined;
    if (repo) contexts.add(repo);
    const project = a.metadata.project as string | undefined;
    if (project) contexts.add(project);
  }
  if (contexts.size > 0) {
    console.log(`        ${styled(c.dim, [...contexts].join("  ·  "))}`);
  }

  // Show URLs (up to 2)
  const urls = cluster.artifacts
    .map((a) => a.sourceUrl)
    .filter(Boolean)
    .slice(0, 2);

  for (const url of urls) {
    console.log(`        ${styled(c.dim, "↗")}  ${styled(c.dim, url)}`);
  }

  if (cluster.artifacts.length > 2) {
    console.log(`        ${styled(c.dim, `+${cluster.artifacts.length - 2} more`)}`);
  }

  console.log();
}

export function printPlan(
  plan: WorkweavePlan,
  meta: { connectors: string[]; rawEvents: number }
): void {
  const scheduled = plan.clusters.filter((c) => c.scheduledSlot);
  const backlog   = plan.clusters.filter((c) => !c.scheduledSlot);

  const modeStr = plan.synthesisMode === "ai"
    ? `AI · ${plan.synthesisProvider ?? "unknown"}`
    : "rules";

  console.log();
  console.log(hr());
  console.log(
    `  ${styled(c.bold, "Workweave Plan")}` +
    styled(c.dim, `  ·  ${formatDate(plan.generatedAt)}`) +
    styled(c.dim, `  ·  ${meta.connectors.join(", ")}`) +
    styled(c.dim, `  ·  ${modeStr}`)
  );
  console.log(hr());
  console.log(
    `  ${styled(c.bWhite, String(scheduled.length))} ${styled(c.dim, "tasks")}` +
    `  ${styled(c.dim, "·")}` +
    `  ${styled(c.bWhite, formatMinutes(plan.usedMinutes))} ${styled(c.dim, "scheduled")}` +
    `  ${styled(c.dim, "·")}` +
    `  ${styled(c.dim, formatMinutes(plan.totalMinutes - plan.usedMinutes) + " remaining")}` +
    `  ${styled(c.dim, "·")}` +
    `  ${styled(c.dim, meta.rawEvents + " events fetched")}`
  );
  console.log();

  scheduled.forEach((cluster, i) => printCluster(cluster, i + 1));

  if (backlog.length > 0) {
    console.log(`  ${styled(c.dim + c.bold, "Backlog")}`);
    console.log();
    backlog.forEach((cluster, i) => printCluster(cluster, scheduled.length + i + 1));
  }

  console.log(dayBar(plan.usedMinutes, plan.totalMinutes));
  console.log();
  console.log(hr());
  console.log();
}

// ── detect output ──────────────────────────────────────────────────────────

export function printDetect(connectors: ConnectorInfo[]): void {
  console.log();
  console.log(hr());
  console.log(`  ${styled(c.bold, "Connector Status")}`);
  console.log(hr());
  console.log();

  for (const info of connectors) {
    if (info.status.available) {
      const caps = info.capabilities.map((cap) => cap.type).join("  ·  ");
      console.log(
        `  ${styled(c.bGreen, "✓")}  ${styled(c.bold, info.name.padEnd(10))}` +
        `  ${styled(c.green, info.status.authMethod.padEnd(8))}` +
        `  ${styled(c.dim, caps)}`
      );
    } else {
      console.log(
        `  ${styled(c.dim, "✗")}  ${styled(c.dim, info.name.padEnd(10))}` +
        `  ${styled(c.dim, info.status.reason)}`
      );
    }
  }

  console.log();
  console.log(hr());
  console.log();
}
