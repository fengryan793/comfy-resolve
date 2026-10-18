import { readFile, writeFile } from "node:fs/promises";
import type { Manifest, ResolvedModel } from "./types.js";

/** Folder relative to models/ where a resolved file belongs: "<dest>/<subdir>" when the workflow used a sub-folder. */
export function destDir(m: Pick<ResolvedModel, "dest" | "subdir">): string {
  return m.subdir ? `${m.dest}/${m.subdir}` : m.dest;
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
}

export async function readManifest(path: string): Promise<Manifest> {
  const m = JSON.parse(await readFile(path, "utf8")) as Manifest;
  if (m.version !== 1) throw new Error(`unsupported manifest version ${String((m as { version?: unknown }).version)}`);
  return m;
}

/**
 * Tab-separated form: `<dest-subdir>\t<repo-or-url>\t<repo-path>\t<dest-file>` per model, "#" comments.
 * Compatible with simple shell loops on a GPU box (`while IFS=$'\t' read ...`).
 */
export function toTsv(manifest: Manifest): string {
  const lines = [`# comfy-resolve manifest v1 for ${manifest.workflow} (${manifest.generatedAt})`];
  for (const m of manifest.models) {
    const repo = m.source === "hf" ? (m.repo ?? "") : m.source === "auto" ? `auto:${m.auto ?? ""}` : m.url;
    const path = m.source === "hf" ? (m.path ?? "") : "";
    lines.push([destDir(m), repo, path, m.basename].join("\t"));
  }
  for (const u of manifest.unresolvedModels) lines.push(`# UNRESOLVED\t${destDir({ dest: u.destGuess, subdir: u.subdir })}\t\t${u.basename}`);
  for (const n of manifest.customNodes) lines.push(`# NODE\t${n.pack}\t${n.repo}`);
  return lines.join("\n") + "\n";
}

export function formatBytes(n: number): string {
  if (n <= 0) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}
