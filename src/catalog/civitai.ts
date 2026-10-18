import { BROWSER_UA, fetchJson, type HttpOptions } from "../http.js";
import { stem } from "../refs.js";
import type { Candidate, ModelRef, Resolution } from "../types.js";
import { civitaiUrl, type ModelSource } from "./types.js";

export interface CivitaiOptions extends HttpOptions {
  token?: string;
  offline?: boolean;
}

interface CivitaiFile { name?: string; sizeKB?: number; hashes?: { SHA256?: string } }
interface CivitaiVersion { id: number; name?: string; files?: CivitaiFile[] }
interface CivitaiModel { name?: string; nsfw?: boolean; modelVersions?: CivitaiVersion[] }

/** Civitai's public model search; exact filename first, same-stem second. Token unlocks NSFW/gated results. */
export class CivitaiCatalog implements ModelSource {
  readonly name = "civitai";
  private readonly headers: Record<string, string>;

  constructor(private readonly opts: CivitaiOptions = {}) {
    const token = opts.token ?? process.env["CIVITAI_API_KEY"] ?? process.env["CIVITAI_TOKEN"];
    this.headers = { "User-Agent": BROWSER_UA, ...(opts.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  private async search(term: string, limit: number): Promise<CivitaiModel[]> {
    const q = new URLSearchParams({ query: term.slice(0, 60), limit: String(limit), nsfw: "true" });
    const o: HttpOptions = { headers: this.headers, timeoutMs: this.opts.timeoutMs ?? 30_000 };
    if (this.opts.fetchImpl) o.fetchImpl = this.opts.fetchImpl;
    const d = await fetchJson<{ items?: CivitaiModel[] }>(`https://civitai.com/api/v1/models?${q}`, o);
    return d?.items ?? [];
  }

  async resolve(ref: ModelRef): Promise<Resolution | null> {
    if (this.opts.offline) return null;
    for (const m of await this.search(stem(ref.basename), 5)) {
      for (const v of m.modelVersions ?? []) {
        for (const f of v.files ?? []) {
          if (f.name === ref.basename) {
            const r: Resolution = { via: "civitai", source: "civitai", url: civitaiUrl(v.id), versionId: v.id, dest: ref.destGuess, confidence: 1 };
            if (m.nsfw !== undefined) r.nsfw = m.nsfw;
            if (f.sizeKB) r.sizeBytes = Math.round(f.sizeKB * 1024);
            if (f.hashes?.SHA256) r.sha256 = f.hashes.SHA256.toLowerCase();
            return r;
          }
        }
      }
    }
    return null;
  }

  async candidates(ref: ModelRef, limit = 4): Promise<Candidate[]> {
    if (this.opts.offline) return [];
    const out: Candidate[] = [];
    const seen = new Set<number>();
    const s = stem(ref.basename);
    const add = (v: CivitaiVersion, m: CivitaiModel, why: string) => {
      if (seen.has(v.id) || out.length >= limit) return;
      seen.add(v.id);
      const c: Candidate = { url: civitaiUrl(v.id), label: `${m.name ?? "?"} - ${why}${m.nsfw ? " (NSFW)" : ""}`, source: "civitai" };
      if (m.nsfw !== undefined) c.nsfw = m.nsfw;
      out.push(c);
    };
    for (const term of [s, s.replace(/_/g, " ")]) {
      const items = await this.search(term, 8);
      for (const m of items) for (const v of m.modelVersions ?? []) for (const f of v.files ?? []) if (f.name === ref.basename) add(v, m, "exact file");
      for (const m of items) for (const v of m.modelVersions ?? []) for (const f of v.files ?? []) if ((f.name ?? "").toLowerCase().includes(s.toLowerCase())) add(v, m, f.name ?? "");
      if (out.length >= limit) break;
    }
    return out;
  }
}
