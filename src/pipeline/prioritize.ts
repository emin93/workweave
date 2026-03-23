import type { Artifact, TaskCluster, TaskCategory, ExecutionAction } from "../types";
import { stableClusterId } from "./cluster-id";

const WEIGHTS = {
  urgency: 0.25,
  importance: 0.2,
  socialPressure: 0.2,
  staleness: 0.15,
  blockingFactor: 0.2,
};

/** Baseline minutes before AI-assist scaling (developer uses Cursor / copilots). */
const TIME_ESTIMATES: Record<string, number> = {
  pr: 18,
  issue_small: 28,
  issue_medium: 55,
  slack_message: 6,
  slack_thread: 10,
  meeting: 12,
};

const AI_ASSIST_TIME_SCALE = 0.52;

export function prioritize(artifacts: Artifact[]): TaskCluster[] {
  const groups = groupIntoCluster(artifacts);
  const scored = groups.map(scoreCluster);
  scored.sort((a, b) => b.priorityScore - a.priorityScore);
  return scored;
}

function groupIntoCluster(artifacts: Artifact[]): TaskCluster[] {
  // Group related artifacts into clusters using union-find
  const parent = new Map<string, string>();

  function find(id: string): string {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const artifact of artifacts) {
    find(artifact.id);
    for (const relId of artifact.relatedArtifactIds) {
      if (artifacts.some((a) => a.id === relId)) {
        union(artifact.id, relId);
      }
    }
  }

  const clusterMap = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    const root = find(artifact.id);
    const group = clusterMap.get(root) ?? [];
    group.push(artifact);
    clusterMap.set(root, group);
  }

  const clusters: TaskCluster[] = [];

  for (const [, group] of clusterMap) {
    const primary = selectPrimaryArtifact(group);
    const category = inferCategory(group);
    const actions = buildActions(group, category);
    const ids = group.map((a) => a.id);

    clusters.push({
      id: stableClusterId(ids),
      title: primary.title,
      summary: buildSummary(group),
      category,
      artifacts: group,
      priorityScore: 0,
      priorityReasons: [],
      estimatedMinutes: estimateTime(group),
      status: "todo",
      actions,
    });
  }

  return clusters;
}

function selectPrimaryArtifact(artifacts: Artifact[]): Artifact {
  // Prefer PRs over issues over messages
  const typeOrder: Record<string, number> = {
    pr: 0,
    issue: 1,
    slack_thread: 2,
    slack_message: 3,
    meeting: 4,
    notion_page: 5,
    commit: 6,
  };

  return [...artifacts].sort(
    (a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99)
  )[0];
}

const INVESTIGATE_PATTERNS = /\b(check out|try out|look into|explore|evaluate|investigate|research|learn about|look at|play with|experiment|spike|poc|proof of concept|compare)\b/i;

export function inferCategory(artifacts: Artifact[]): TaskCategory {
  const types = new Set(artifacts.map((a) => a.type));
  if (types.has("pr")) {
    const pr = artifacts.find((a) => a.type === "pr");
    if (pr?.metadata.isAuthor) return "follow_up";
    return "review";
  }
  if (types.has("slack_message") || types.has("slack_thread")) return "respond";
  if (types.has("meeting")) return "meeting_prep";

  if (types.has("issue")) {
    const text = artifacts
      .map((a) => `${a.title} ${a.description ?? ""}`)
      .join(" ");
    if (INVESTIGATE_PATTERNS.test(text)) return "investigate";
    return "implementation";
  }

  return "other";
}

export function buildActions(
  artifacts: Artifact[],
  category: TaskCategory
): ExecutionAction[] {
  const actions: ExecutionAction[] = [];
  const primary = selectPrimaryArtifact(artifacts);

  // ── 1. Primary action: the single "do this now" button ──

  switch (category) {
    case "review":
      if (primary.type === "pr") {
        actions.push({
          id: "primary",
          type: "review",
          label: "Review",
          icon: "git-pull-request",
          params: {
            prUrl: primary.sourceUrl,
            repository: primary.metadata.repository,
            prNumber: primary.externalId,
            branch: primary.metadata.headRefName,
          },
        });
      }
      break;

    case "follow_up":
      if (primary.type === "pr") {
        actions.push({
          id: "primary",
          type: "review",
          label: "Check PR",
          icon: "git-pull-request",
          params: {
            prUrl: primary.sourceUrl,
            repository: primary.metadata.repository,
            prNumber: primary.externalId,
            branch: primary.metadata.headRefName,
          },
        });
      }
      break;

    case "implementation":
      actions.push({
        id: "primary",
        type: "plan",
        label: "Plan",
        icon: "lightbulb",
        params: {
          issueUrl: primary.sourceUrl,
          title: primary.title,
          description: primary.description,
          externalId: primary.externalId,
          connectorId: primary.connectorId,
        },
      });
      break;

    case "investigate":
      actions.push({
        id: "primary",
        type: "investigate",
        label: "Research",
        icon: "search",
        params: {
          issueUrl: primary.sourceUrl,
          title: primary.title,
          description: primary.description,
          externalId: primary.externalId,
          connectorId: primary.connectorId,
        },
      });
      break;

    case "respond":
      actions.push({
        id: "primary",
        type: "start_work",
        label: "Reply",
        icon: "reply",
        params: { url: primary.sourceUrl },
      });
      break;

    default:
      actions.push({
        id: "primary",
        type: "open_url",
        label: "Open",
        icon: "link-external",
        params: { url: primary.sourceUrl },
      });
      break;
  }

  // ── 2. Context links: every related source the developer might need ──
  // Ordered by likely usefulness: Slack context first (someone pinged you),
  // then the issue/PR itself, then other links.

  const primaryUrl = primary.sourceUrl;
  const seenUrls = new Set<string>([primaryUrl]);

  const contextOrder: Record<string, number> = {
    slack_message: 0,
    slack_thread: 1,
    pr: 2,
    issue: 3,
    meeting: 4,
    notion_page: 5,
    commit: 6,
  };

  const contextArtifacts = [...artifacts]
    .filter((a) => a.id !== primary.id && a.sourceUrl && !seenUrls.has(a.sourceUrl))
    .sort((a, b) => (contextOrder[a.type] ?? 99) - (contextOrder[b.type] ?? 99));

  for (const artifact of contextArtifacts) {
    if (seenUrls.has(artifact.sourceUrl)) continue;
    seenUrls.add(artifact.sourceUrl);

    actions.push({
      id: `ctx-${artifact.id}`,
      type: "context_link",
      label: contextLabel(artifact),
      icon: contextIcon(artifact),
      params: {
        url: artifact.sourceUrl,
        source: artifact.connectorId,
        artifactType: artifact.type,
      },
    });
  }

  // If the primary artifact's URL wasn't already used as the primary action's
  // direct open target, or if there are extra links in metadata, add them.
  const metadataLinks = (primary.metadata.links as string[]) ?? [];
  for (const link of metadataLinks) {
    if (seenUrls.has(link)) continue;
    seenUrls.add(link);
    actions.push({
      id: `link-${actions.length}`,
      type: "context_link",
      label: linkLabel(link),
      icon: "link-external",
      params: { url: link, source: "link", artifactType: "link" },
    });
  }

  // ── 3. Utilities: Done and Snooze ──

  actions.push({
    id: "mark_done",
    type: "mark_done",
    label: "Done",
    icon: "check",
    params: {},
  });

  actions.push({
    id: "snooze",
    type: "snooze",
    label: "Snooze",
    icon: "clock",
    params: {},
  });

  return actions;
}

function contextLabel(artifact: Artifact): string {
  switch (artifact.type) {
    case "slack_message":
    case "slack_thread": {
      const from = artifact.metadata.from as string | undefined;
      const isDm = artifact.metadata.isDm as boolean;
      if (isDm && from) return `DM from ${from}`;
      if (from) return `${from} in Slack`;
      return "Slack message";
    }
    case "pr":
      return artifact.metadata.isAuthor ? "Your PR" : "PR";
    case "issue":
      return artifact.connectorId === "linear" ? "Linear ticket" : "Issue";
    case "meeting":
      return "Meeting";
    case "notion_page":
      return "Notion page";
    case "commit":
      return "Commit";
    default:
      return "Link";
  }
}

function contextIcon(artifact: Artifact): string {
  switch (artifact.connectorId) {
    case "slack":
      return "message-square";
    case "github":
      return artifact.type === "pr" ? "git-pull-request" : "github";
    case "linear":
      return "list-ordered";
    default:
      return "link-external";
  }
}

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    if (host.includes("github.com")) return "GitHub";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("linear.app")) return "Linear";
    if (host.includes("slack.com")) return "Slack";
    return host.split(".")[0];
  } catch {
    return "Link";
  }
}

export function buildSummary(artifacts: Artifact[]): string {
  if (artifacts.length === 1) {
    const a = artifacts[0];
    if (a.connectorId === "slack") {
      const from = (a.metadata.from as string) ?? "someone";
      const isDm = a.metadata.isDm as boolean;
      const channel = (a.metadata.channel as string) ?? "Slack";
      return isDm ? `DM from ${from}` : `${from} in #${channel}`;
    }
    if (a.connectorId === "github") {
      return (a.metadata.repository as string) ?? "GitHub";
    }
    if (a.connectorId === "linear") {
      const project = (a.metadata.project as string) ?? undefined;
      return project ? `Linear · ${project}` : "Linear";
    }
    return a.connectorId;
  }

  const sources = [...new Set(artifacts.map((a) => a.connectorId))];
  return `${artifacts.length} related items from ${sources.join(", ")}`;
}

function estimateTime(artifacts: Artifact[]): number {
  let total = 0;
  for (const a of artifacts) {
    if (a.type === "pr") {
      const additions = (a.metadata.additions as number) ?? 0;
      const deletions = (a.metadata.deletions as number) ?? 0;
      const lines = additions + deletions;
      total += lines > 500 ? 38 : lines > 100 ? 22 : 12;
    } else if (a.type === "issue") {
      const estimate = (a.metadata.estimate as number) ?? 0;
      if (estimate > 0) {
        total += estimate * 14; // Linear points -> minutes (AI-assisted)
      } else {
        total += TIME_ESTIMATES.issue_small;
      }
    } else {
      total += TIME_ESTIMATES[a.type] ?? 12;
    }
  }
  return Math.max(5, Math.round(total * AI_ASSIST_TIME_SCALE));
}

function scoreCluster(cluster: TaskCluster): TaskCluster {
  const reasons: string[] = [];
  let urgency = 0;
  let importance = 0;
  let socialPressure = 0;
  let staleness = 0;
  let blockingFactor = 0;

  const now = Date.now();

  for (const artifact of cluster.artifacts) {
    // Urgency: deadline proximity
    const dueDate =
      (artifact.metadata.dueDate as string) ?? undefined;
    if (dueDate) {
      const daysUntil =
        (new Date(dueDate).getTime() - now) / (1000 * 60 * 60 * 24);
      const u = Math.max(0, Math.min(1, 1 - daysUntil / 14));
      if (u > urgency) {
        urgency = u;
        if (daysUntil <= 1) reasons.push("Due tomorrow");
        else if (daysUntil <= 3)
          reasons.push(`Due in ${Math.ceil(daysUntil)} days`);
      }
    }

    // Importance: priority field
    if (artifact.priority !== undefined && artifact.priority > importance) {
      importance = artifact.priority;
      const label =
        (artifact.metadata.priorityLabel as string) ?? `P${Math.round((1 - artifact.priority) * 3)}`;
      reasons.push(`Priority: ${label}`);
    }

    // Social pressure: review requests, mentions
    if (artifact.type === "pr") {
      const reviewRequests = (artifact.metadata.reviewRequests as unknown[]) ?? [];
      if (reviewRequests.length > 0) {
        const sp = Math.min(reviewRequests.length / 5, 1);
        if (sp > socialPressure) {
          socialPressure = sp;
          reasons.push(
            `${reviewRequests.length} reviewer${reviewRequests.length > 1 ? "s" : ""} waiting`
          );
        }
      }
    }

    if (artifact.type === "slack_message") {
      const sp = 0.6;
      if (sp > socialPressure) {
        socialPressure = sp;
        const from = artifact.metadata.from as string | undefined;
        reasons.push(from ? `@mentioned by ${from}` : "@mentioned in Slack");
      }
    }

    // Staleness: age
    const createdAt = new Date(artifact.createdAt).getTime();
    const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);
    const s = Math.min(daysOld / 7, 1);
    if (s > staleness) {
      staleness = s;
      if (daysOld > 3) {
        reasons.push(`${Math.round(daysOld)} days old`);
      }
    }

    // Blocking factor: labels
    const labels = (artifact.metadata.labels as string[]) ?? [];
    const isBlocking = labels.some((l) => {
      const lower = l.toLowerCase();
      return (
        lower.includes("block") ||
        lower.includes("urgent") ||
        lower.includes("critical")
      );
    });
    if (isBlocking) {
      blockingFactor = 1;
      reasons.push("Marked as blocking");
    }
  }

  const score =
    (WEIGHTS.urgency * urgency +
      WEIGHTS.importance * importance +
      WEIGHTS.socialPressure * socialPressure +
      WEIGHTS.staleness * staleness +
      WEIGHTS.blockingFactor * blockingFactor) *
    100;

  return {
    ...cluster,
    priorityScore: Math.round(score * 10) / 10,
    priorityReasons: [...new Set(reasons)],
  };
}
