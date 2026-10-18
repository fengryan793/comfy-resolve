import lookupJson from "../../data/lookup.json" with { type: "json" };
import type { ModelRef, Resolution } from "../types.js";
import { entryToResolution, type CatalogEntry, type ModelSource } from "./types.js";

export type LookupTable = Record<string, CatalogEntry>;

/** Keys starting with "_" are comments. */
export function cleanTable(raw: Record<string, unknown>): LookupTable {
  const out: LookupTable = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_") || typeof v !== "object" || v === null) continue;
    out[k] = v as CatalogEntry;
  }
  return out;
}

/** The curated table shipped with the package: every entry is a verified download. */
export const BUNDLED_LOOKUP: LookupTable = cleanTable(lookupJson as Record<string, unknown>);

export class TableSource implements ModelSource {
  constructor(
    readonly name: "bundled" | "override",
    private readonly table: LookupTable,
  ) {}

  async resolve(ref: ModelRef): Promise<Resolution | null> {
    // Full reference first (keeps folder-specific entries), then the bare basename.
    const entry = this.table[ref.ref] ?? this.table[ref.basename];
    return entry ? entryToResolution(entry, ref, this.name) : null;
  }
}

export function bundledSource(): TableSource {
  return new TableSource("bundled", BUNDLED_LOOKUP);
}
