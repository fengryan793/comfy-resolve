import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BROWSER_UA } from "./http.js";
import { destDir } from "./manifest.js";
import type { Manifest, ResolvedModel } from "./types.js";

export type DownloadStatus = "exists" | "ok" | "auto" | "failed" | "dry-run";

export interface DownloadResult {
  model: ResolvedModel;
  target: string;
  status: DownloadStatus;
  bytes: number;
  sha256?: string;
  error?: string;
  resumedFrom?: number;
}

export interface DownloadProgress {
  model: ResolvedModel;
  received: number;
  total?: number;
}

export interface DownloadOptions {
  /** ComfyUI's models/ directory; files land in <modelsDir>/<dest>/<subdir>/<basename>. */
  modelsDir: string;
  concurrency?: number;
  /** Only download models whose basename is in this list. */
  only?: string[];
  /** Verify SHA-256 against the manifest when known (default true). */
  verify?: boolean;
  dryRun?: boolean;
  hfToken?: string;
  civitaiToken?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (p: DownloadProgress) => void;
  onResult?: (r: DownloadResult) => void;
  timeoutMs?: number;
}

function headersFor(m: ResolvedModel, opts: DownloadOptions): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": BROWSER_UA };
  const hf = opts.hfToken ?? process.env["HF_TOKEN"];
  const cv = opts.civitaiToken ?? process.env["CIVITAI_API_KEY"] ?? process.env["CIVITAI_TOKEN"];
  if (m.source === "hf" || /huggingface\.co\//.test(m.url)) { if (hf) h["Authorization"] = `Bearer ${hf}`; }
  else if (m.source === "civitai" || /civitai\.com\//.test(m.url)) { if (cv) h["Authorization"] = `Bearer ${cv}`; }
  return h;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

/** Where a manifest entry lands on disk. */
export function targetPath(m: ResolvedModel, modelsDir: string): string {
  return join(modelsDir, destDir(m), m.basename);
}

async function downloadOne(m: ResolvedModel, opts: DownloadOptions): Promise<DownloadResult> {
  const target = targetPath(m, opts.modelsDir);
  const base: DownloadResult = { model: m, target, status: "failed", bytes: 0 };
  if (m.source === "auto" || !m.url) return { ...base, status: "auto" };
  try {
    const s = await stat(target);
    if (s.size > 0) return { ...base, status: "exists", bytes: s.size };
  } catch { /* not there */ }
  if (opts.dryRun) return { ...base, status: "dry-run" };

  const part = target + ".part";
  let offset = 0;
  try { offset = (await stat(part)).size; } catch { /* fresh */ }
  await mkdir(dirname(target), { recursive: true });

  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = headersFor(m, opts);
  if (offset > 0) headers["Range"] = `bytes=${offset}-`;
  const ac = new AbortController();
  const idle = opts.timeoutMs ?? 120_000;
  let timer = setTimeout(() => ac.abort(), idle);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), idle); };
  try {
    const res = await fetchImpl(m.url, { headers, redirect: "follow", signal: ac.signal });
    let resumed = false;
    if (res.status === 416 && offset > 0) {
      // Server says our .part already covers the whole file.
      resumed = true;
    } else if (res.status === 206 && offset > 0) {
      resumed = true;
    } else if (res.status === 200) {
      if (offset > 0) { await rm(part, { force: true }); offset = 0; } // server ignored Range
    } else if (!res.ok) {
      return { ...base, status: "failed", error: `HTTP ${res.status}` };
    }
    const lenHeader = res.headers.get("content-length");
    const total = lenHeader ? offset + Number(lenHeader) : undefined;
    let received = offset;
    const hash = resumed ? null : createHash("sha256");
    if (res.status !== 416 && res.body) {
      const counter = new (await import("node:stream")).Transform({
        transform(chunk: Buffer, _enc, cb) {
          received += chunk.length;
          hash?.update(chunk);
          bump();
          opts.onProgress?.(total !== undefined ? { model: m, received, total } : { model: m, received });
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), counter, createWriteStream(part, { flags: offset > 0 ? "a" : "w" }));
    }
    const digest = hash ? hash.digest("hex") : (opts.verify !== false && m.sha256) ? await sha256File(part) : undefined;
    if (opts.verify !== false && m.sha256 && digest && digest !== m.sha256.toLowerCase()) {
      await rm(part, { force: true });
      return { ...base, status: "failed", bytes: received, error: `sha256 mismatch: expected ${m.sha256}, got ${digest}` };
    }
    const finalSize = (await stat(part)).size;
    if (finalSize === 0) { await rm(part, { force: true }); return { ...base, status: "failed", error: "empty response" }; }
    await rename(part, target);
    const out: DownloadResult = { ...base, status: "ok", bytes: finalSize };
    if (digest) out.sha256 = digest;
    if (offset > 0) out.resumedFrom = offset;
    return out;
  } catch (err) {
    return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Download every resolved model in a manifest. Existing non-empty files are skipped; .part files resume. */
export async function downloadManifest(manifest: Manifest, opts: DownloadOptions): Promise<DownloadResult[]> {
  const only = opts.only ? new Set(opts.only) : null;
  const queue = manifest.models.filter((m) => !only || only.has(m.basename) || only.has(m.ref));
  const results: DownloadResult[] = [];
  const workers = Math.max(1, Math.min(opts.concurrency ?? 3, queue.length));
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const i = next++;
      const m = queue[i];
      if (!m) return;
      const r = await downloadOne(m, opts);
      results[i] = r;
      opts.onResult?.(r);
    }
  }));
  return results;
}

/**
 * A bash script that fetches the manifest on a box without Node (GPU pods). Uses `hf download`
 * for Hugging Face files when available (parallel, resumable) and `curl -C -` otherwise.
 */
export function toScript(manifest: Manifest, modelsDir = "/workspace/ComfyUI/models"): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    "#!/usr/bin/env bash",
    `# generated by comfy-resolve for ${manifest.workflow} (${manifest.generatedAt})`,
    "set -uo pipefail",
    `MODELS=${q(modelsDir)}`,
    'HF_AUTH=(); [ -n "${HF_TOKEN:-}" ] && HF_AUTH=(-H "Authorization: Bearer $HF_TOKEN")',
    'CV_AUTH=(); [ -n "${CIVITAI_API_KEY:-}" ] && CV_AUTH=(-H "Authorization: Bearer $CIVITAI_API_KEY")',
    `UA=${q(BROWSER_UA)}`,
    "fail=0",
    "fetch() { # dest-dir url file [auth...]",
    '  local dir="$MODELS/$1" url="$2" file="$3"; shift 3',
    '  mkdir -p "$dir"; [ -s "$dir/$file" ] && { echo "exists  $file"; return; }',
    '  if curl -fL --retry 3 -C - -A "$UA" "$@" -o "$dir/$file.part" "$url" && [ -s "$dir/$file.part" ]; then mv "$dir/$file.part" "$dir/$file"; echo "ok      $file"; else echo "FAILED  $file"; fail=1; fi',
    "}",
    "hf_fetch() { # dest-dir repo path file",
    '  local dir="$MODELS/$1" repo="$2" path="$3" file="$4"',
    '  mkdir -p "$dir"; [ -s "$dir/$file" ] && { echo "exists  $file"; return; }',
    '  if command -v hf >/dev/null 2>&1; then',
    '    HF_HUB_ENABLE_HF_TRANSFER=1 hf download "$repo" "$path" --local-dir "$MODELS/.comfy-resolve-dl" >/dev/null && mv "$MODELS/.comfy-resolve-dl/$path" "$dir/$file" && echo "ok      $file" && return',
    "  fi",
    '  fetch "$1" "https://huggingface.co/$repo/resolve/main/$path" "$file" "${HF_AUTH[@]}"',
    "}",
    "",
  ];
  for (const m of manifest.models) {
    if (m.source === "auto") { lines.push(`# ${m.basename}: fetched automatically by the node pack (${m.auto ?? "auto"})`); continue; }
    const dir = destDir(m);
    if (m.source === "hf" && m.repo && m.path) lines.push(`hf_fetch ${q(dir)} ${q(m.repo)} ${q(m.path)} ${q(m.basename)}`);
    else if (m.source === "civitai" || /civitai\.com\//.test(m.url)) lines.push(`fetch ${q(dir)} ${q(m.url)} ${q(m.basename)} "\${CV_AUTH[@]}"`);
    else lines.push(`fetch ${q(dir)} ${q(m.url)} ${q(m.basename)}`);
  }
  for (const u of manifest.unresolvedModels) lines.push(`echo "UNRESOLVED ${u.basename} -> ${u.destGuess}/" ; fail=1`);
  if (manifest.customNodes.length) {
    lines.push("", 'NODES="$(dirname "$MODELS")/custom_nodes"; mkdir -p "$NODES"');
    for (const n of manifest.customNodes) {
      lines.push(`( cd "$NODES" && { [ -d ${q(n.pack)} ] || git clone --depth=1 ${q(n.repo)} ${q(n.pack)}; } && { [ -f ${q(n.pack)}/requirements.txt ] && python3 -m pip install -q -r ${q(n.pack)}/requirements.txt || true; } ) || { echo "FAILED node ${n.pack}"; fail=1; }`);
    }
  }
  lines.push("", 'rm -rf "$MODELS/.comfy-resolve-dl"', "exit $fail", "");
  return lines.join("\n");
}
