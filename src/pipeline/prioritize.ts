import type { Artifact, TaskCluster, TaskCategory, ExecutionAction } from "../types";

const WEIGHTS = {
  urgency: 0.25,
  importance: 0.2,
  socialPressure: 0.2,
  staleness: 0.15,
  blockingFactor: 0.2,
};

const TIME_ESTIMATES: Record<string, number> = {
  pr: 30,
  issue_small: 60,
  issue_medium: 120,
  slack_message: 10,
  slack_thread: 15,
  meeting: 15,
};

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

  let clusterIndex = 0;
  const clusters: TaskCluster[] = [];

  for (const [, group] of clusterMap) {
    const primary = selectPrimaryArtifact(group);
    const category = inferCategory(group);
    const actions = buildActions(group, category);

    clusters.push({
      id: `cluster-${clusterIndex++}`,
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

function inferCategory(artifacts: Artifact[]): TaskCategory {
  const types = new Set(artifacts.map((a) => a.type));
  if (types.has("pr")) return "review";
  if (types.has("slack_message") || types.has("slack_thread")) return "respond";
  if (types.has("meeting")) return "meeting_prep";
  if (types.has("issue")) return "implementation";
  return "other";
}

function buildActions(
  artifacts: Artifact[],
  category: TaskCategory
): ExecutionAction[] {
  const actions: ExecutionAction[] = [];
  const primary = selectPrimaryArtifact(artifacts);

  if (category === "review" && primary.type === "pr") {
    actions.push({
      id: "review",
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

  if (category === "implementation" && primary.type === "issue") {
    actions.push({
      id: "plan",
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
  }

  if (category === "respond") {
    actions.push({
      id: "start_work",
      type: "start_work",
      label: "Reply",
      icon: "reply",
      params: { url: primary.sourceUrl },
    });
  }

  actions.push({
    id: "open_url",
    type: "open_url",
    label: "Open",
    icon: "link-external",
    params: { url: primary.sourceUrl },
  });

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

function buildSummary(artifacts: Artifact[]): string {
  if (artifacts.length === 1) {
    const a = artifacts[0];
    const source =
      a.connectorId === "github"
        ? (a.metadata.repository as string) ?? "GitHub"
        : a.connectorId === "linear"
          ? "Linear"
          : a.connectorId === "slack"
            ? `#${(a.metadata.channel as string) ?? "Slack"}`
            : a.connectorId;
    return source;
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
      total += lines > 500 ? 60 : lines > 100 ? 30 : 15;
    } else if (a.type === "issue") {
      const estimate = (a.metadata.estimate as number) ?? 0;
      if (estimate > 0) {
        total += estimate * 30; // Linear points -> minutes
      } else {
        total += TIME_ESTIMATES.issue_small;
      }
    } else {
      total += TIME_ESTIMATES[a.type] ?? 15;
    }
  }
  return total;
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
