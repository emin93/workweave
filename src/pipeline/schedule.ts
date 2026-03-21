import type { TaskCluster, WorkdayPlan } from "../types";
import { randomUUID } from "crypto";

const AFFINITY_THRESHOLD = 10;

/**
 * Priority-first scheduler with context-affinity nudging.
 *
 * 1. Takes clusters already sorted by priority score (highest first)
 * 2. Nudges related adjacent items together when the priority gap is small
 * 3. Fills time slots sequentially until workdayMinutes is reached
 * 4. Overflow stays in the plan without a scheduledSlot (backlog)
 */
export function schedule(
  clusters: TaskCluster[],
  workdayMinutes: number
): WorkdayPlan {
  const ordered = nudgeRelatedItems([...clusters]);

  let minutesUsed = 0;

  const scheduled = ordered.map((cluster) => {
    if (minutesUsed >= workdayMinutes) {
      return cluster;
    }

    const start = minutesUsed;
    const end = Math.min(start + cluster.estimatedMinutes, workdayMinutes);
    minutesUsed += cluster.estimatedMinutes;

    return {
      ...cluster,
      scheduledSlot: { start, end },
    };
  });

  const today = new Date().toISOString().split("T")[0];

  return {
    id: randomUUID(),
    date: today,
    clusters: scheduled,
    totalMinutes: workdayMinutes,
    usedMinutes: Math.min(minutesUsed, workdayMinutes),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * If a lower-priority cluster shares context (same repo, project, or linked
 * artifacts) with the cluster right above it, and the score gap is within
 * AFFINITY_THRESHOLD, pull it up so the developer stays in the same context.
 */
function nudgeRelatedItems(clusters: TaskCluster[]): TaskCluster[] {
  for (let i = 1; i < clusters.length; i++) {
    const prev = clusters[i - 1];
    const curr = clusters[i];

    if (sharesContext(prev, curr)) continue; // already adjacent

    // Look ahead for a related cluster that's close enough in priority
    for (let j = i + 1; j < clusters.length; j++) {
      const candidate = clusters[j];
      const gap = prev.priorityScore - candidate.priorityScore;
      if (gap > AFFINITY_THRESHOLD) break; // too far in priority

      if (sharesContext(prev, candidate)) {
        // Pull candidate up to position i
        clusters.splice(j, 1);
        clusters.splice(i, 0, candidate);
        break;
      }
    }
  }

  return clusters;
}

function sharesContext(a: TaskCluster, b: TaskCluster): boolean {
  const reposA = extractContextKeys(a);
  const reposB = extractContextKeys(b);

  for (const key of reposA) {
    if (reposB.has(key)) return true;
  }

  // Check if any artifacts are directly linked
  const idsA = new Set(a.artifacts.map((art) => art.id));
  for (const art of b.artifacts) {
    for (const relId of art.relatedArtifactIds) {
      if (idsA.has(relId)) return true;
    }
  }

  return false;
}

function extractContextKeys(cluster: TaskCluster): Set<string> {
  const keys = new Set<string>();

  for (const art of cluster.artifacts) {
    const repo = art.metadata.repository as string | undefined;
    if (repo) keys.add(`repo:${repo}`);

    const project = art.metadata.project as string | undefined;
    if (project) keys.add(`project:${project}`);

    const channel = art.metadata.channel as string | undefined;
    if (channel) keys.add(`channel:${channel}`);
  }

  return keys;
}
