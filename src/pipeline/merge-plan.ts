import type { Artifact, TaskCluster } from "../types";
import { stableClusterId } from "./cluster-id";
import { buildActions, buildSummary, inferCategory } from "./prioritize";

/** Calendar date string aligned with `WorkweavePlan.date` / `getCachedPlan` (UTC YYYY-MM-DD). */
export function calendarTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Drop clusters with no remaining artifacts; refresh artifact refs and actions from current data.
 */
export function pruneAndRefreshClusters(
  clusters: TaskCluster[],
  artifactById: Map<string, Artifact>
): TaskCluster[] {
  const out: TaskCluster[] = [];
  for (const c of clusters) {
    const kept = c.artifacts
      .map((a) => artifactById.get(a.id))
      .filter((a): a is Artifact => !!a);
    if (kept.length === 0) continue;

    const category = inferCategory(kept);
    const actions = buildActions(kept, category);
    const id = stableClusterId(kept.map((a) => a.id));

    out.push({
      ...c,
      id,
      category,
      artifacts: kept,
      summary: buildSummary(kept),
      actions,
    });
  }
  return out;
}

/**
 * Insert each incoming cluster by descending priority score without reordering
 * existing clusters relative to each other.
 */
export function mergeByPriorityInsertion(
  oldClusters: TaskCluster[],
  newClusters: TaskCluster[]
): TaskCluster[] {
  const result = [...oldClusters];
  const sortedNew = [...newClusters].sort(
    (a, b) => b.priorityScore - a.priorityScore
  );
  for (const nc of sortedNew) {
    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      if (nc.priorityScore > result[i].priorityScore) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, nc);
  }
  return result;
}

export function applyClusterStatuses(
  merged: TaskCluster[],
  previous: TaskCluster[]
): TaskCluster[] {
  const prevById = new Map(previous.map((c) => [c.id, c]));
  return merged.map((c) => {
    const p = prevById.get(c.id);
    if (!p) return c;
    return {
      ...c,
      status: p.status,
      snoozedUntil: p.snoozedUntil,
    };
  });
}
