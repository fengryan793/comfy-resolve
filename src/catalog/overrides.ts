import { readFile } from "node:fs/promises";
import { cleanTable, TableSource, type LookupTable } from "./bundled.js";

/**
 * Load a user overrides file. Same shape as the bundled table:
 * `{ "<filename>": { "url": "https://..." , "dest": "loras" } }` or `{ "hf": "org/repo", "path": "x.safetensors" }`
 * or `{ "civitai": 143906 }`.
 */
export async function loadOverrides(path: string): Promise<LookupTable> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`overrides file ${path} must be a JSON object keyed by filename`);
  }
  return cleanTable(raw as Record<string, unknown>);
}

export function overrideSource(table: LookupTable): TableSource {
  return new TableSource("override", table);
}
