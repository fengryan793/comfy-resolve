import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isModelFile } from "./refs.js";

export type VerifyProblem = "too-small" | "bad-header" | "partial" | "unreadable";

export interface VerifyIssue {
  path: string;
  problem: VerifyProblem;
  detail: string;
}

export interface VerifyOptions {
  /** Files below this size are flagged (default 1 MiB). ComfyUI's `put_*` placeholders are ignored. */
  minBytes?: number;
}

const MAX_HEADER = 200 * 1024 * 1024;

/** A safetensors file starts with a little-endian u64 header length followed by that many bytes of JSON. */
export async function checkSafetensorsHeader(path: string): Promise<string | null> {
  const fh = await open(path, "r");
  try {
    const lenBuf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(lenBuf, 0, 8, 0);
    if (bytesRead < 8) return "file shorter than 8 bytes";
    const n = Number(lenBuf.readBigUInt64LE(0));
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HEADER) return `implausible header length ${n}`;
    const size = (await fh.stat()).size;
    if (8 + n > size) return `header length ${n} exceeds file size ${size}`;
    const hdr = Buffer.alloc(n);
    await fh.read(hdr, 0, n, 8);
    try {
      const parsed = JSON.parse(hdr.toString("utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null) return "header JSON is not an object";
    } catch {
      return "header is not valid JSON";
    }
    return null;
  } finally {
    await fh.close();
  }
}

/** Walk a models/ directory and report truncated or corrupt weight files. */
export async function verifyModelsDir(dir: string, opts: VerifyOptions = {}): Promise<VerifyIssue[]> {
  const minBytes = opts.minBytes ?? 1024 * 1024;
  const issues: VerifyIssue[] = [];
  if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new Error(`not a directory: ${dir}`);
  async function walk(d: string): Promise<void> {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!e.isFile()) continue;
      if (e.name.endsWith(".part")) { issues.push({ path: p, problem: "partial", detail: "unfinished download" }); continue; }
      if (!isModelFile(e.name) || e.name.startsWith("put_")) continue;
      let size: number;
      try { size = (await stat(p)).size; } catch (err) { issues.push({ path: p, problem: "unreadable", detail: String(err) }); continue; }
      if (size < minBytes) { issues.push({ path: p, problem: "too-small", detail: `${size} bytes` }); continue; }
      if (e.name.toLowerCase().endsWith(".safetensors")) {
        try {
          const bad = await checkSafetensorsHeader(p);
          if (bad) issues.push({ path: p, problem: "bad-header", detail: bad });
        } catch (err) {
          issues.push({ path: p, problem: "unreadable", detail: String(err) });
        }
      }
    }
  }
  await walk(dir);
  return issues;
}
