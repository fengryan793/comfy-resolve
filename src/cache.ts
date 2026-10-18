import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchWithRetry, type HttpOptions } from "./http.js";

export function defaultCacheDir(): string {
  return process.env["COMFY_RESOLVE_CACHE_DIR"] ?? join(homedir(), ".cache", "comfy-resolve");
}

export interface CachedJsonOptions extends HttpOptions {
  cacheDir?: string;
  /** Max age before a refresh is attempted. Default 24h. */
  ttlMs?: number;
  /** Never touch the network; return the cached copy or null. */
  offline?: boolean;
}

/**
 * Fetch a JSON document through an on-disk cache. Within the TTL the cache is used as-is;
 * after it, a conditional GET (ETag) refreshes it; on network failure the stale copy is kept.
 */
export async function cachedJson<T = unknown>(url: string, name: string, opts: CachedJsonOptions = {}): Promise<T | null> {
  const dir = opts.cacheDir ?? defaultCacheDir();
  const file = join(dir, name);
  const meta = join(dir, `${name}.meta.json`);
  const ttl = opts.ttlMs ?? 24 * 3600 * 1000;
  let cached: T | null = null;
  let etag: string | undefined;
  let fresh = false;
  try {
    const s = await stat(file);
    cached = JSON.parse(await readFile(file, "utf8")) as T;
    fresh = Date.now() - s.mtimeMs < ttl;
    try {
      etag = (JSON.parse(await readFile(meta, "utf8")) as { etag?: string }).etag;
    } catch { /* no meta */ }
  } catch { /* no cache */ }
  if (opts.offline || (cached !== null && fresh)) return cached;
  try {
    const headers = { ...(opts.headers ?? {}) };
    if (etag) headers["If-None-Match"] = etag;
    const res = await fetchWithRetry(url, { ...opts, headers, timeoutMs: opts.timeoutMs ?? 60_000 });
    if (res.status === 304 && cached !== null) {
      await writeFile(file, JSON.stringify(cached)); // bump mtime
      return cached;
    }
    if (!res.ok) return cached;
    const text = await res.text();
    const data = JSON.parse(text) as T;
    await mkdir(dir, { recursive: true });
    await writeFile(file, text);
    const newTag = res.headers.get("etag");
    if (newTag) await writeFile(meta, JSON.stringify({ etag: newTag, url, fetchedAt: new Date().toISOString() }));
    return data;
  } catch {
    return cached;
  }
}
