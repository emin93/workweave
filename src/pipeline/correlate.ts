import type { Artifact } from "../types";

/**
 * Links related artifacts by matching IDs, URLs, and branch names across sources.
 * For V1, this is purely deterministic (regex + exact match).
 */
export function correlate(artifacts: Artifact[]): Artifact[] {
  const urlIndex = new Map<string, string>();
  const idPatterns = new Map<string, string[]>();

  for (const artifact of artifacts) {
    urlIndex.set(artifact.sourceUrl, artifact.id);

    const ids = extractIdentifiers(artifact);
    for (const id of ids) {
      const existing = idPatterns.get(id) ?? [];
      existing.push(artifact.id);
      idPatterns.set(id, existing);
    }
  }

  const correlated = artifacts.map((artifact) => {
    const related = new Set(artifact.relatedArtifactIds);

    // Match by identifiers found in title/description
    const textToSearch = [
      artifact.title,
      artifact.description ?? "",
      String(artifact.metadata.headRefName ?? ""),
    ].join(" ");

    for (const other of artifacts) {
      if (other.id === artifact.id) continue;

      // Check if this artifact's text mentions the other's external ID
      if (textMentionsId(textToSearch, other)) {
        related.add(other.id);
      }

      // Check if the other artifact's text mentions this one
      const otherText = [
        other.title,
        other.description ?? "",
        String(other.metadata.headRefName ?? ""),
      ].join(" ");

      if (textMentionsId(otherText, artifact)) {
        related.add(other.id);
      }
    }

    return {
      ...artifact,
      relatedArtifactIds: Array.from(related),
    };
  });

  return correlated;
}

function extractIdentifiers(artifact: Artifact): string[] {
  const ids: string[] = [];

  ids.push(artifact.externalId);

  if (artifact.connectorId === "linear" && artifact.externalId) {
    ids.push(artifact.externalId); // e.g., "ENG-451"
  }

  if (artifact.connectorId === "github") {
    const repo = artifact.metadata.repository as string | undefined;
    if (repo) {
      ids.push(`${repo}#${artifact.externalId}`);
    }
  }

  return ids;
}

function textMentionsId(text: string, artifact: Artifact): boolean {
  const externalId = artifact.externalId;

  // Direct mention of issue/PR number with # prefix
  if (artifact.connectorId === "github") {
    const repo = artifact.metadata.repository as string | undefined;
    if (repo && text.includes(`${repo}#${externalId}`)) return true;
    if (text.match(new RegExp(`#${externalId}\\b`))) return true;
  }

  // Linear identifier (e.g., ENG-451)
  if (artifact.connectorId === "linear") {
    if (text.includes(externalId)) return true;
  }

  // URL match
  if (text.includes(artifact.sourceUrl)) return true;

  return false;
}
