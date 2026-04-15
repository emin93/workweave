import type {
  Artifact,
  TaskCluster,
  TaskCategory,
} from "../types";
import type { LLMProvider } from "../ai/provider";
import { stableClusterId } from "./cluster-id";
import { buildActions } from "./prioritize";
import { correlate } from "./correlate";
import { prioritize } from "./prioritize";

export interface AISynthesisResult {
  clusters: TaskCluster[];
  mode: "ai" | "rules";
}

interface LLMCluster {
  artifactIds: string[];
  title: string;
  summary: string;
  category: TaskCategory;
  priorityScore: number;
  priorityReasons: string[];
  estimatedMinutes: number;
}

interface LLMResponse {
  clusters: LLMCluster[];
  reasoning?: string;
}

const VALID_CATEGORIES = new Set<TaskCategory>([
  "review",
  "implementation",
  "respond",
  "investigate",
  "meeting_prep",
  "follow_up",
  "other",
]);

/** Scale LLM time estimates toward AI-assisted work (Cursor, Copilot). */
const AI_ASSIST_TIME_FACTOR = 0.62;

const CATEGORY_MINUTE_CAPS: Partial<Record<TaskCategory, number>> = {
  review: 45,
  respond: 22,
  investigate: 55,
  implementation: 85,
  follow_up: 45,
  meeting_prep: 28,
  other: 55,
};

const GLOBAL_MAX_MINUTES = 120;

function clampAiEstimateMinutes(
  category: TaskCategory,
  raw: number | undefined
): number {
  let m = typeof raw === "number" && !Number.isNaN(raw) ? raw : 18;
  m = Math.round(m * AI_ASSIST_TIME_FACTOR);
  const cap = CATEGORY_MINUTE_CAPS[category] ?? 60;
  m = Math.min(m, cap, GLOBAL_MAX_MINUTES);
  return Math.max(5, m);
}

export async function aiSynthesize(
  artifacts: Artifact[],
  provider: LLMProvider,
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<AISynthesisResult> {
  if (artifacts.length === 0) {
    return { clusters: [], mode: "rules" };
  }

  try {
    const available = await provider.isAvailable();
    if (!available) {
      log?.info("AI provider not available, falling back to rules");
      return fallback(artifacts);
    }

    log?.info(`AI synthesis: sending ${artifacts.length} artifacts to ${provider.name}`);

    const prompt = buildPrompt(artifacts);
    const raw = await provider.complete(prompt);

    if (!raw || raw.trim().length === 0) {
      log?.warn("AI returned empty response, falling back to rules");
      return fallback(artifacts);
    }

    const parsed = parseResponse(raw, artifacts);
    if (!parsed) {
      log?.warn("AI response could not be parsed, falling back to rules");
      return fallback(artifacts);
    }

    const clusters = hydrateClusters(parsed, artifacts);
    log?.info(`AI synthesis: ${clusters.length} clusters from LLM`);

    return { clusters, mode: "ai" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`AI synthesis failed: ${msg}, falling back to rules`);
    return fallback(artifacts);
  }
}

function fallback(artifacts: Artifact[]): AISynthesisResult {
  const correlated = correlate(artifacts);
  const clusters = prioritize(correlated);
  return { clusters, mode: "rules" };
}

function buildArtifactItems(artifacts: Artifact[]) {
  return artifacts.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description?.slice(0, 300),
    source: a.connectorId,
    sourceUrl: a.sourceUrl,
    priority: a.priority,
    createdAt: a.createdAt,
    metadata: {
      author: a.metadata.author,
      isAuthor: a.metadata.isAuthor,
      repository: a.metadata.repository,
      project: a.metadata.project,
      labels: a.metadata.labels,
      dueDate: a.metadata.dueDate,
      state: a.metadata.state,
      priorityLabel: a.metadata.priorityLabel,
      channel: a.metadata.channel,
      isDm: a.metadata.isDm,
      from: a.metadata.from,
      links: a.metadata.links,
      estimate: a.metadata.estimate,
    },
  }));
}

function buildPrompt(artifacts: Artifact[]): string {
  const items = artifacts.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description?.slice(0, 300),
    source: a.connectorId,
    sourceUrl: a.sourceUrl,
    priority: a.priority,
    createdAt: a.createdAt,
    metadata: {
      author: a.metadata.author,
      isAuthor: a.metadata.isAuthor,
      repository: a.metadata.repository,
      project: a.metadata.project,
      labels: a.metadata.labels,
      dueDate: a.metadata.dueDate,
      state: a.metadata.state,
      priorityLabel: a.metadata.priorityLabel,
      channel: a.metadata.channel,
      isDm: a.metadata.isDm,
      from: a.metadata.from,
      links: a.metadata.links,
      estimate: a.metadata.estimate,
    },
  }));

  return `You are a developer workday planner. Analyze these work items from multiple tools and synthesize them into an actionable, prioritized plan for today.

## Work Items
${JSON.stringify(items, null, 2)}

## Instructions

1. **Group related items** into clusters. Items are related if they reference the same PR, issue, project, or topic. A Slack message about a PR should be grouped with that PR. Items with no relation should be their own cluster.

2. **Write a clear, actionable title** for each cluster. Instead of raw identifiers like "WOR-5: Implement auth", write something like "Implement authentication flow". For Slack messages, summarize the ask: "Reply to John about the auth refactor".

3. **Write a 1-sentence summary** explaining why this task matters or what context the developer needs.

4. **Categorize** each cluster:
   - "review" — PR that needs code review (not authored by the developer)
   - "follow_up" — PR authored by the developer that needs attention (merge, address comments)
   - "implementation" — coding task, feature, or bug fix
   - "investigate" — research, evaluate a tool, spike, POC
   - "respond" — reply to a message, thread, or discussion
   - "meeting_prep" — prepare for a meeting
   - "other" — anything else

5. **Score priority** 0-100 based on:
   - Urgency (deadlines, due dates, how old it is)
   - Importance (priority labels, blocking status)
   - Social pressure (people waiting, @mentions, review requests)
   - Impact (how many people or systems are affected)

6. **Provide priority reasons** — 1-3 short phrases explaining the score.

7. **Estimate time** in minutes for each cluster. Assume the developer uses **AI coding assistants** (Cursor, Copilot, etc.): estimates are **active time** to decide, review, and ship with tooling — not manual greenfield coding. Anchors: Slack reply ~5–15m; small PR review ~10–25m; larger PR ~20–45m; focused implementation ~20–55m; quick investigate ~15–35m.

8. **Order clusters** to minimize context switching — group related work together when priority allows.

Return ONLY valid JSON matching this schema (no markdown fences, no explanation outside the JSON):
{
  "clusters": [
    {
      "artifactIds": ["artifact-id-1", "artifact-id-2"],
      "title": "Human-readable actionable title",
      "summary": "Why this matters, 1 sentence",
      "category": "review|implementation|respond|investigate|follow_up|meeting_prep|other",
      "priorityScore": 75,
      "priorityReasons": ["Due tomorrow", "Blocking release"],
      "estimatedMinutes": 30
    }
  ],
  "reasoning": "Brief explanation of ordering logic"
}`;
}

function parseResponse(
  raw: string,
  artifacts: Artifact[]
): LLMResponse | null {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text) as LLMResponse;

    if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
      return null;
    }

    const artifactIds = new Set(artifacts.map((a) => a.id));

    const validClusters = parsed.clusters.filter((c) => {
      if (!Array.isArray(c.artifactIds) || c.artifactIds.length === 0) {
        return false;
      }
      if (!c.title || typeof c.title !== "string") return false;
      if (typeof c.priorityScore !== "number") return false;
      return true;
    });

    // Deduplicate: each artifact can only appear in one cluster (first wins).
    // Small models sometimes repeat clusters or reassign the same artifacts.
    const claimedIds = new Set<string>();
    const deduped: LLMCluster[] = [];
    for (const cluster of validClusters) {
      cluster.artifactIds = cluster.artifactIds.filter(
        (id) => artifactIds.has(id) && !claimedIds.has(id)
      );
      if (cluster.artifactIds.length === 0) continue;
      cluster.artifactIds.forEach((id) => claimedIds.add(id));
      deduped.push(cluster);
    }
    const uniqueClusters = deduped;

    for (const cluster of uniqueClusters) {
      if (!VALID_CATEGORIES.has(cluster.category)) {
        cluster.category = "other";
      }
      cluster.priorityScore = Math.max(
        0,
        Math.min(100, cluster.priorityScore)
      );
      cluster.estimatedMinutes = cluster.estimatedMinutes || 15;
      cluster.priorityReasons = cluster.priorityReasons || [];
      cluster.summary = cluster.summary || "";
    }

    const unassigned = artifacts
      .filter((a) => !claimedIds.has(a.id));

    for (const artifact of unassigned) {
      uniqueClusters.push({
        artifactIds: [artifact.id],
        title: artifact.title,
        summary: artifact.connectorId,
        category: "other",
        priorityScore: 20,
        priorityReasons: [],
        estimatedMinutes: 15,
      });
    }

    return {
      clusters: uniqueClusters,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

function hydrateClusters(
  response: LLMResponse,
  artifacts: Artifact[]
): TaskCluster[] {
  const artifactMap = new Map(artifacts.map((a) => [a.id, a]));

  return response.clusters.map((llmCluster) => {
    const clusterArtifacts = llmCluster.artifactIds
      .map((id) => artifactMap.get(id))
      .filter((a): a is Artifact => !!a);

    const category = llmCluster.category;
    const actions = buildActions(clusterArtifacts, category);
    const ids = clusterArtifacts.map((a) => a.id);

    return {
      id: stableClusterId(ids),
      title: llmCluster.title,
      summary: llmCluster.summary,
      category,
      artifacts: clusterArtifacts,
      priorityScore: llmCluster.priorityScore,
      priorityReasons: llmCluster.priorityReasons,
      estimatedMinutes: clampAiEstimateMinutes(
        category,
        llmCluster.estimatedMinutes
      ),
      status: "todo" as const,
      actions,
    };
  });
}
