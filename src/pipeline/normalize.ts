import type { RawEvent, Artifact, ArtifactType } from "../types";

export function normalize(events: RawEvent[]): Artifact[] {
  const artifacts: Artifact[] = [];

  for (const event of events) {
    const artifact = normalizeEvent(event);
    if (artifact) {
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

function normalizeEvent(event: RawEvent): Artifact | null {
  switch (event.connectorId) {
    case "github":
      return normalizeGitHub(event);
    case "linear":
      return normalizeLinear(event);
    case "slack":
      return normalizeSlack(event);
    default:
      return null;
  }
}

function normalizeGitHub(event: RawEvent): Artifact | null {
  const payload = event.rawPayload as Record<string, unknown>;

  if (event.sourceType === "pr") {
    return {
      id: event.id,
      type: "pr" as ArtifactType,
      title: `PR #${payload.number}: ${payload.title}`,
      description: (payload.body as string) ?? undefined,
      sourceUrl: payload.url as string,
      connectorId: "github",
      externalId: String(payload.number),
      priority: undefined,
      createdAt: payload.createdAt as string,
      updatedAt: payload.updatedAt as string,
      metadata: {
        author: (payload.author as Record<string, unknown>)?.login,
        isAuthor: payload.isAuthor,
        labels: ((payload.labels as Array<Record<string, unknown>>) ?? []).map(
          (l) => l.name
        ),
        repository: (payload.repository as Record<string, unknown>)
          ?.nameWithOwner,
        headRefName: payload.headRefName,
        additions: payload.additions,
        deletions: payload.deletions,
        reviewRequests: payload.reviewRequests,
      },
      relatedArtifactIds: [],
    };
  }

  if (event.sourceType === "issue") {
    const labels = (
      (payload.labels as Array<Record<string, unknown>>) ?? []
    ).map((l) => l.name as string);

    const priorityFromLabels = extractPriorityFromLabels(labels);

    return {
      id: event.id,
      type: "issue" as ArtifactType,
      title: `#${payload.number}: ${payload.title}`,
      description: (payload.body as string) ?? undefined,
      sourceUrl: payload.url as string,
      connectorId: "github",
      externalId: String(payload.number),
      priority: priorityFromLabels,
      createdAt: payload.createdAt as string,
      updatedAt: payload.updatedAt as string,
      metadata: {
        author: (payload.author as Record<string, unknown>)?.login,
        labels,
        repository: (payload.repository as Record<string, unknown>)
          ?.nameWithOwner,
      },
      relatedArtifactIds: [],
    };
  }

  return null;
}

function normalizeLinear(event: RawEvent): Artifact | null {
  const payload = event.rawPayload as Record<string, unknown>;

  if (event.sourceType === "issue") {
    const priority = payload.priority as number | undefined;
    // Linear priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low
    const normalizedPriority =
      priority !== undefined && priority > 0
        ? 1 - (priority - 1) / 3 // 1->1.0, 2->0.67, 3->0.33, 4->0.0
        : undefined;

    return {
      id: event.id,
      type: "issue" as ArtifactType,
      title: `${payload.identifier}: ${payload.title}`,
      description: (payload.description as string) ?? undefined,
      sourceUrl: payload.url as string,
      connectorId: "linear",
      externalId: payload.identifier as string,
      priority: normalizedPriority,
      createdAt: payload.createdAt as string,
      updatedAt: payload.updatedAt as string,
      metadata: {
        priorityLabel: payload.priorityLabel,
        estimate: payload.estimate,
        dueDate: payload.dueDate,
        state: payload.state,
        labels: (
          (payload.labels as Record<string, unknown>)?.nodes as Array<
            Record<string, unknown>
          >
        )?.map((l) => l.name),
        project: (payload.project as Record<string, unknown>)?.name,
        cycle: payload.cycle,
      },
      relatedArtifactIds: [],
    };
  }

  return null;
}

function normalizeSlack(event: RawEvent): Artifact | null {
  const payload = event.rawPayload as Record<string, unknown>;

  if (event.sourceType === "slack_message") {
    const rawText = (payload.text as string) ?? "";
    const cleanText = (payload.cleanText as string) ?? rawText;
    const channel = (payload.channel as string) ?? "unknown";
    const isDm = (payload.isDm as boolean) ?? false;
    const from = (payload.from as string) ?? "someone";
    const permalink = (payload.permalink as string) ?? "";
    const ts = payload.ts as string;
    const links = (payload.links as string[]) ?? [];

    const preview =
      cleanText.length > 100 ? cleanText.slice(0, 100) + "..." : cleanText;

    const locationLabel = isDm ? `DM from ${from}` : `#${channel}`;
    const title = preview
      ? `${preview}`
      : `Message from ${from}`;

    const createdAt = ts
      ? new Date(Number(ts) * 1000).toISOString()
      : new Date().toISOString();

    return {
      id: event.id,
      type: "slack_message" as ArtifactType,
      title,
      description: `${from} in ${locationLabel}`,
      sourceUrl: permalink,
      connectorId: "slack",
      externalId: ts ?? event.id,
      priority: 0.5,
      createdAt,
      updatedAt: createdAt,
      metadata: {
        channel,
        channelId: payload.channelId,
        isDm,
        from,
        threadTs: payload.threadTs,
        links,
      },
      relatedArtifactIds: [],
    };
  }

  return null;
}

function extractPriorityFromLabels(labels: string[]): number | undefined {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "p0" || lower === "critical" || lower === "urgent")
      return 1.0;
    if (lower === "p1" || lower === "high") return 0.75;
    if (lower === "p2" || lower === "medium") return 0.5;
    if (lower === "p3" || lower === "low") return 0.25;
  }
  return undefined;
}
