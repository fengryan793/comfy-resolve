/** Minimal fetch helpers: timeout, retry with jitter, JSON decoding. No dependencies. */

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { headers = {}, timeoutMs = 30_000, retries = 2, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ac.signal, redirect: "follow" });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(300 * 2 ** attempt + Math.random() * 200);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET a JSON document; returns null on any non-2xx status or network failure. */
export async function fetchJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T | null> {
  try {
    const res = await fetchWithRetry(url, opts);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Desktop-Chrome UA; Civitai rejects or throttles requests without a browser-like UA. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
