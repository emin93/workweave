import { createHash } from "crypto";

/**
 * Stable id for a cluster from its artifact membership (same set => same id across runs).
 */
export function stableClusterId(artifactIds: string[]): string {
  const key = [...artifactIds].sort().join("|");
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `cluster-${hash}`;
}
