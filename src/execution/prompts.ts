import type { TaskCluster, Artifact } from "../types";

export function buildPlanPrompt(cluster: TaskCluster): string {
  const primary = cluster.artifacts.find((a) => a.type === "issue") ?? cluster.artifacts[0];

  const relatedContext = cluster.artifacts
    .filter((a) => a.id !== primary.id)
    .map((a) => `- [${a.type}] ${a.title}: ${a.sourceUrl}`)
    .join("\n");

  return `I need to plan the implementation of this task.

**Title:** ${primary.title}
**Source:** ${primary.connectorId} (${primary.externalId})
**URL:** ${primary.sourceUrl}
${primary.description ? `**Description:** ${primary.description.slice(0, 500)}` : ""}
${primary.priority !== undefined ? `**Priority:** ${primary.metadata.priorityLabel ?? primary.priority}` : ""}
${(primary.metadata.dueDate as string) ? `**Due:** ${primary.metadata.dueDate}` : ""}
${relatedContext ? `\n**Related context:**\n${relatedContext}` : ""}

Please analyze this task and create an implementation plan. Consider the codebase structure and suggest a step-by-step approach.`;
}

export function buildReviewPrompt(cluster: TaskCluster): string {
  const pr = cluster.artifacts.find((a) => a.type === "pr") ?? cluster.artifacts[0];

  const additions = (pr.metadata.additions as number) ?? 0;
  const deletions = (pr.metadata.deletions as number) ?? 0;
  const author = (pr.metadata.author as string) ?? "unknown";

  return `I need to review this pull request.

**Title:** ${pr.title}
**Author:** ${author}
**URL:** ${pr.sourceUrl}
**Changes:** +${additions} / -${deletions} lines
**Branch:** ${pr.metadata.headRefName ?? "unknown"}
${pr.description ? `**Description:** ${pr.description.slice(0, 500)}` : ""}

Please review the changes in this PR. Focus on:
1. Correctness and potential bugs
2. Code quality and maintainability
3. Performance implications
4. Missing edge cases or tests`;
}
