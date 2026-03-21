import type { TaskCluster, WorkdayPlan, TaskCategory } from "../types";
import { randomUUID } from "crypto";

const CATEGORY_ORDER: TaskCategory[] = [
  "respond",
  "review",
  "implementation",
  "meeting_prep",
  "investigate",
  "follow_up",
  "other",
];

/**
 * Greedy bin-packing scheduler with type grouping.
 * 
 * 1. Sort clusters by priority (already done upstream)
 * 2. Group adjacent same-category clusters
 * 3. Fill time slots until workdayMinutes is reached
 * 4. Overflow goes to backlog (still in plan, but without scheduled slots)
 */
export function schedule(
  clusters: TaskCluster[],
  workdayMinutes: number
): WorkdayPlan {
  const grouped = groupByCategory(clusters);
  const ordered = orderGroups(grouped);

  let minutesUsed = 0;

  const scheduled = ordered.map((cluster) => {
    if (minutesUsed >= workdayMinutes) {
      return cluster; // backlog -- no slot assigned
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

function groupByCategory(
  clusters: TaskCluster[]
): Map<TaskCategory, TaskCluster[]> {
  const groups = new Map<TaskCategory, TaskCluster[]>();

  for (const cluster of clusters) {
    const existing = groups.get(cluster.category) ?? [];
    existing.push(cluster);
    groups.set(cluster.category, existing);
  }

  return groups;
}

function orderGroups(
  groups: Map<TaskCategory, TaskCluster[]>
): TaskCluster[] {
  const result: TaskCluster[] = [];

  // Quick tasks first (respond), then reviews, then deep work
  for (const category of CATEGORY_ORDER) {
    const group = groups.get(category);
    if (group) {
      // Within each category, already sorted by priority
      result.push(...group);
    }
  }

  return result;
}
