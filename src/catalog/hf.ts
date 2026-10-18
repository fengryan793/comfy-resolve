import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultCacheDir } from "../cache.js";
import { fetchJson, type HttpOptions } from "../http.js";
import { normBase, stem } from "../refs.js";
import type { Candidate, ModelRef, Resolution } from "../types.js";
import { hfUrl, type ModelSource } from "./types.js";

/** Repos that host most ComfyUI-ecosystem weights; indexed once so bare filenames resolve without a search. */
export const INDEX_REPOS: readonly string[] = [
  "Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
  "Comfy-Org/Qwen-Image_ComfyUI", "Comfy-Org/Qwen-Image-Edit_ComfyUI",
  "Comfy-Org/Qwen-Image-Edit-2509_ComfyUI", "Comfy-Org/Qwen-Image-Edit-2511_ComfyUI",
  "Comfy-Org/Krea-2", "Comfy-Org/flux2-klein", "Comfy-Org/flux2-dev",
  "Comfy-Org/Lumina_Image_2.0_Repackaged", "Comfy-Org/HunyuanVideo_repackaged",
  "Comfy-Org/LTX-2", "Comfy-Org/ltx-2", "Comfy-Org/stable-diffusion-3.5-fp8",
  "Comfy-Org/flux1-dev", "Comfy-Org/flux1-schnell", "Comfy-Org/sigclip_vision_384",
  "Kijai/WanVideo_comfy", "Kijai/WanVideo_comfy_fp8_scaled", "Kijai/flux-fp8",
  "lightx2v/Qwen-Image-Lightning", "lightx2v/Wan2.2-Distill-Loras",
  "Lightricks/LTX-Video", "Lightricks/LTX-2",
  "comfyanonymous/flux_text_encoders", "city96/t5-v1_1-xxl-encoder-gguf",
  "stabilityai/stable-diffusion-xl-base-1.0", "SG161222/RealVisXL_V5.0",
  "black-forest-labs/FLUX.2-klein-9B", "InstantX/InstantID",
];

const WEIGHT_EXT = /\.(safetensors|gguf|onnx|pt|pth|bin|ckpt|sft)$/i;

export interface HfFile {
  path: string;
  size?: number;
  sha256?: string;
}

/** basename -> [repo, path] */
export type FileIndex = Record<string, [string, string]>;

export interface HfOptions extends HttpOptions {
  token?: string;
  cacheDir?: string;
  offline?: boolean;
  /** Pre-built index (tests / air-gapped). */
  index?: FileIndex;
  repos?: readonly string[];
}

interface HfModelInfo {
  id?: string;
  siblings?: { rfilename: string }[];
}

interface HfTreeEntry {
  type: string;
  path: string;
  size?: number;
  lfs?: { sha256?: string; size?: number };
}

export class HfCatalog implements ModelSource {
  readonly name = "hf-index";
  private indexP?: Promise<FileIndex>;
  private readonly headers: Record<string, string>;

  constructor(private readonly opts: HfOptions = {}) {
    const token = opts.token ?? process.env["HF_TOKEN"];
    this.headers = { ...(opts.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  private http(): HttpOptions {
    const o: HttpOptions = { headers: this.headers, timeoutMs: this.opts.timeoutMs ?? 30_000 };
    if (this.opts.fetchImpl) o.fetchImpl = this.opts.fetchImpl;
    return o;
  }

  /** Weight files of a repo via the model-info endpoint (one request, no sizes). */
  async listFiles(repo: string): Promise<string[]> {
    const info = await fetchJson<HfModelInfo>(`https://huggingface.co/api/models/${repo}`, this.http());
    return (info?.siblings ?? []).map((s) => s.rfilename).filter((p) => WEIGHT_EXT.test(p));
  }

  /** Size + sha256 for one file via the tree endpoint. */
  async fileMeta(repo: string, path: string): Promise<HfFile | null> {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const entries = await fetchJson<HfTreeEntry[]>(
      `https://huggingface.co/api/models/${repo}/tree/main${dir ? "/" + dir.split("/").map(encodeURIComponent).join("/") : ""}`,
      this.http(),
    );
    const hit = entries?.find((e) => e.path === path);
    if (!hit) return null;
    const out: HfFile = { path };
    const size = hit.lfs?.size ?? hit.size;
    if (size !== undefined) out.size = size;
    if (hit.lfs?.sha256) out.sha256 = hit.lfs.sha256;
    return out;
  }

  /** Build (or load) the basename -> (repo, path) index over INDEX_REPOS. First repo wins. */
  index(): Promise<FileIndex> {
    if (!this.indexP) {
      this.indexP = (async () => {
        if (this.opts.index) return this.opts.index;
        const dir = this.opts.cacheDir ?? defaultCacheDir();
        const file = join(dir, "hf-org-index.json");
        try {
          return JSON.parse(await readFile(file, "utf8")) as FileIndex;
        } catch { /* build below */ }
        if (this.opts.offline) return {};
        const idx: FileIndex = {};
        for (const repo of this.opts.repos ?? INDEX_REPOS) {
          for (const p of await this.listFiles(repo)) {
            const base = normBase(p);
            if (!(base in idx)) idx[base] = [repo, p];
          }
        }
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(file, JSON.stringify(idx));
        } catch { /* cache is best-effort */ }
        return idx;
      })();
    }
    return this.indexP;
  }

  async resolve(ref: ModelRef): Promise<Resolution | null> {
    const hit = (await this.index())[ref.basename];
    if (!hit) return null;
    const [repo, path] = hit;
    return { via: "hf-index", source: "hf", url: hfUrl(repo, path), repo, path, dest: ref.destGuess, confidence: 1 };
  }

  /** Live full-text search for a repo containing exactly this basename. */
  async searchFile(ref: ModelRef): Promise<Resolution | null> {
    if (this.opts.offline) return null;
    const hits = await fetchJson<HfModelInfo[]>(
      `https://huggingface.co/api/models?search=${encodeURIComponent(ref.basename)}&limit=5`,
      this.http(),
    );
    for (const m of hits ?? []) {
      if (!m.id) continue;
      for (const p of await this.listFiles(m.id)) {
        if (normBase(p) === ref.basename) {
          return { via: "hf-search", source: "hf", url: hfUrl(m.id, p), repo: m.id, path: p, dest: ref.destGuess, confidence: 1 };
        }
      }
    }
    return null;
  }

  /**
   * Ranked candidate URLs for a human to pick from. HF search matches repo names, not file
   * names, so a long community-renamed file will not match; we search progressively shorter
   * leading-token groups to find the repo, then list its weight files as a "browse" fallback.
   */
  async candidates(ref: ModelRef, limit = 6): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    const add = (repo: string, path: string, label: string) => {
      const url = hfUrl(repo, path);
      if (!seen.has(url) && out.length < limit) { seen.add(url); out.push({ url, label, source: "hf" }); }
    };
    const idxHit = (await this.index())[ref.basename];
    if (idxHit) add(idxHit[0], idxHit[1], `${idxHit[0]} - exact file (index)`);
    if (this.opts.offline) return out;
    const s = stem(ref.basename);
    const toks = s.split(/[ _\-.]+/).filter((t) => t.length > 1).slice(0, 6);
    const terms = [ref.basename, s, s.replace(/_/g, " ").slice(0, 60)];
    for (const k of [3, 2, 1]) if (toks.length >= k) terms.push(toks.slice(0, k).join(" "));
    const browse: [string, string][] = [];
    const tried = new Set<string>();
    for (const term of terms) {
      if (!term || tried.has(term)) continue;
      tried.add(term);
      const hits = await fetchJson<HfModelInfo[]>(
        `https://huggingface.co/api/models?search=${encodeURIComponent(term)}&limit=6`,
        this.http(),
      );
      for (const m of hits ?? []) {
        if (!m.id) continue;
        const files = await this.listFiles(m.id);
        for (const p of files) if (normBase(p) === ref.basename) add(m.id, p, `${m.id} - exact file`);
        for (const p of files) if (normBase(p).toLowerCase().includes(s.toLowerCase())) add(m.id, p, `${m.id} - same stem: ${normBase(p)}`);
        for (const p of files) browse.push([m.id, p]);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    for (const [repo, p] of browse) {
      if (out.length >= limit) break;
      add(repo, p, `${repo} - browse: ${normBase(p)} (possible rename)`);
    }
    return out;
  }
}
