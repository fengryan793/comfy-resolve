import type { Candidate, ModelRef, Resolution } from "../types.js";

/** A place that can turn a model reference into a download source. Cheapest sources go first. */
export interface ModelSource {
  readonly name: string;
  resolve(ref: ModelRef): Promise<Resolution | null>;
  /** Ranked alternatives for a human to pick from when nothing matched exactly. */
  candidates?(ref: ModelRef, limit: number): Promise<Candidate[]>;
}

/** Maps a node class name to the git repo providing it. */
export interface NodeSource {
  readonly name: string;
  resolveNode(className: string): Promise<string | null>;
}

/** One entry of the bundled lookup table or a user overrides file. */
export interface CatalogEntry {
  hf?: string;
  path?: string;
  civitai?: number;
  url?: string;
  dest?: string;
  gb?: number;
  sha256?: string;
  /** The node pack fetches this file itself on first run; record it but do not download. */
  auto?: string;
}

export function hfUrl(repo: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function civitaiUrl(versionId: number): string {
  return `https://civitai.com/api/download/models/${versionId}`;
}

/** Turn a lookup/override entry into a Resolution, or null when it names no source. */
export function entryToResolution(
  entry: CatalogEntry,
  ref: ModelRef,
  via: Resolution["via"],
): Resolution | null {
  const dest = entry.dest ?? ref.destGuess;
  const sizeBytes = entry.gb !== undefined ? Math.round(entry.gb * 1e9) : undefined;
  const common = { via, dest, confidence: 2 as const, ...(sizeBytes !== undefined ? { sizeBytes } : {}), ...(entry.sha256 ? { sha256: entry.sha256 } : {}) };
  if (entry.hf) {
    const path = entry.path ?? ref.basename;
    return { ...common, source: "hf", url: hfUrl(entry.hf, path), repo: entry.hf, path };
  }
  if (entry.civitai !== undefined) {
    return { ...common, source: "civitai", url: civitaiUrl(entry.civitai), versionId: entry.civitai };
  }
  if (entry.url) {
    return { ...common, source: "url", url: entry.url };
  }
  if (entry.auto) {
    return { ...common, source: "auto", url: "", auto: entry.auto };
  }
  return null;
}
