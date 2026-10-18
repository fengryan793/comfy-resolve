import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadManifest, toScript, verifyModelsDir, checkSafetensorsHeader, type Manifest, type ResolvedModel } from "../src/index.js";

const BODY = Buffer.alloc(3 * 1024 * 1024);
for (let i = 0; i < BODY.length; i++) BODY[i] = (i * 31 + 7) & 0xff;
const SHA = createHash("sha256").update(BODY).digest("hex");

let server: Server;
let base = "";
let requests: { range?: string; auth?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = req.headers["authorization"];
    requests.push({ ...(req.headers.range ? { range: req.headers.range } : {}), ...(auth ? { auth } : {}) });
    if (req.url === "/missing") { res.writeHead(404); res.end(); return; }
    if (req.url === "/noRange") { res.writeHead(200, { "content-length": BODY.length }); res.end(BODY); return; }
    const range = req.headers.range;
    if (range) {
      const start = Number(range.replace("bytes=", "").split("-")[0]);
      if (start >= BODY.length) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, { "content-length": BODY.length - start, "content-range": `bytes ${start}-${BODY.length - 1}/${BODY.length}` });
      res.end(BODY.subarray(start));
      return;
    }
    res.writeHead(200, { "content-length": BODY.length });
    res.end(BODY);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function model(url: string, extra: Partial<ResolvedModel> = {}): ResolvedModel {
  return { ref: "file.safetensors", basename: "file.safetensors", subdir: "", loader: "VAELoader", destGuess: "vae",
    via: "override", source: "url", url, dest: "vae", confidence: 2, ...extra };
}
function manifest(models: ResolvedModel[]): Manifest {
  return { version: 1, generatedAt: "t", workflow: "w", selfHostable: true, apiNodes: [], models, unresolvedModels: [], customNodes: [], unresolvedNodes: [], droppableMissing: [], totalBytes: 0 };
}

describe("downloadManifest", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "comfy-resolve-")); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("downloads into <models>/<dest>/<subdir>/ and verifies sha256", async () => {
    requests = [];
    const [r] = await downloadManifest(manifest([model(`${base}/f`, { subdir: "sub", sha256: SHA })]), { modelsDir: join(dir, "a") });
    expect(r?.status).toBe("ok");
    expect(r?.sha256).toBe(SHA);
    expect((await stat(join(dir, "a", "vae", "sub", "file.safetensors"))).size).toBe(BODY.length);
    const [again] = await downloadManifest(manifest([model(`${base}/f`, { subdir: "sub" })]), { modelsDir: join(dir, "a") });
    expect(again?.status).toBe("exists");
  });

  it("resumes a .part file with a Range request and still verifies the hash", async () => {
    requests = [];
    const md = join(dir, "b");
    await mkdir(join(md, "vae"), { recursive: true });
    await writeFile(join(md, "vae", "file.safetensors.part"), BODY.subarray(0, 1_000_000));
    const [r] = await downloadManifest(manifest([model(`${base}/f`, { sha256: SHA })]), { modelsDir: md });
    expect(r?.status).toBe("ok");
    expect(r?.resumedFrom).toBe(1_000_000);
    expect(requests[0]?.range).toBe("bytes=1000000-");
    expect((await readFile(join(md, "vae", "file.safetensors"))).equals(BODY)).toBe(true);
  });

  it("restarts from zero when the server ignores Range", async () => {
    const md = join(dir, "c");
    await mkdir(join(md, "vae"), { recursive: true });
    await writeFile(join(md, "vae", "file.safetensors.part"), Buffer.from("garbage"));
    const [r] = await downloadManifest(manifest([model(`${base}/noRange`, { sha256: SHA })]), { modelsDir: md });
    expect(r?.status).toBe("ok");
    expect((await readFile(join(md, "vae", "file.safetensors"))).equals(BODY)).toBe(true);
  });

  it("fails and removes the file on a hash mismatch, reports 404s, skips auto", async () => {
    const md = join(dir, "d");
    const rs = await downloadManifest(manifest([
      model(`${base}/f`, { sha256: "0".repeat(64) }),
      model(`${base}/missing`, { basename: "m.safetensors" }),
      model("", { basename: "auto.pth", source: "auto", auto: "reactor-first-run" }),
    ]), { modelsDir: md, concurrency: 2 });
    expect(rs.map((r) => r.status)).toEqual(["failed", "failed", "auto"]);
    expect(rs[0]?.error).toMatch(/sha256 mismatch/);
    expect(rs[1]?.error).toBe("HTTP 404");
    await expect(stat(join(md, "vae", "file.safetensors"))).rejects.toThrow();
    await expect(stat(join(md, "vae", "file.safetensors.part"))).rejects.toThrow();
  });

  it("sends the Civitai token only to civitai and dry-runs without touching the network", async () => {
    requests = [];
    const md = join(dir, "e");
    const rs = await downloadManifest(manifest([model(`${base}/f`)]), { modelsDir: md, dryRun: true });
    expect(rs[0]?.status).toBe("dry-run");
    expect(requests.length).toBe(0);
    await downloadManifest(manifest([model(`${base}/f`, { source: "civitai", basename: "c.safetensors" })]), { modelsDir: md, civitaiToken: "cvtok", hfToken: "hftok" });
    expect(requests[0]?.auth).toBe("Bearer cvtok");
  });
});

describe("toScript", () => {
  it("emits hf_fetch for HF files, fetch for others, notes auto and unresolved, clones nodes", () => {
    const m = manifest([
      model("https://huggingface.co/org/repo/resolve/main/a/b.safetensors", { source: "hf", repo: "org/repo", path: "a/b.safetensors", basename: "b.safetensors" }),
      model("https://civitai.com/api/download/models/1", { source: "civitai", basename: "c.safetensors", dest: "loras" }),
      model("", { source: "auto", auto: "reactor-first-run", basename: "g.pth" }),
    ]);
    m.unresolvedModels.push({ ref: "x.safetensors", basename: "x.safetensors", subdir: "", loader: "UNETLoader", destGuess: "diffusion_models", candidates: [] });
    m.customNodes.push({ class: "Foo", repo: "https://github.com/a/ComfyUI-Foo", pack: "ComfyUI-Foo" });
    const s = toScript(m, "/w/models");
    expect(s).toContain(`hf_fetch 'vae' 'org/repo' 'a/b.safetensors' 'b.safetensors'`);
    expect(s).toContain(`fetch 'loras' 'https://civitai.com/api/download/models/1' 'c.safetensors' "\${CV_AUTH[@]}"`);
    expect(s).toContain("# g.pth: fetched automatically");
    expect(s).toContain("UNRESOLVED x.safetensors");
    expect(s).toContain("git clone --depth=1 'https://github.com/a/ComfyUI-Foo' 'ComfyUI-Foo'");
    expect(s.startsWith("#!/usr/bin/env bash")).toBe(true);
  });
});

describe("verifyModelsDir", () => {
  it("flags small files, bad headers and .part leftovers; accepts a valid safetensors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comfy-verify-"));
    try {
      await mkdir(join(dir, "loras"), { recursive: true });
      const header = Buffer.from(JSON.stringify({ __metadata__: {}, w: { dtype: "F32", shape: [1], data_offsets: [0, 4] } }));
      const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(header.length));
      const good = Buffer.concat([len, header, Buffer.alloc(2 * 1024 * 1024)]);
      await writeFile(join(dir, "loras", "good.safetensors"), good);
      const badLen = Buffer.alloc(8); badLen.writeBigUInt64LE(BigInt(999_999_999));
      await writeFile(join(dir, "loras", "bad.safetensors"), Buffer.concat([badLen, Buffer.alloc(2 * 1024 * 1024)]));
      await writeFile(join(dir, "loras", "tiny.safetensors"), Buffer.alloc(10));
      await writeFile(join(dir, "loras", "put_loras_here"), "");
      await writeFile(join(dir, "loras", "half.safetensors.part"), Buffer.alloc(5));
      await writeFile(join(dir, "loras", "notes.txt"), "ignored");
      expect(await checkSafetensorsHeader(join(dir, "loras", "good.safetensors"))).toBeNull();
      const issues = await verifyModelsDir(dir);
      const by = Object.fromEntries(issues.map((i) => [i.path.split("/").pop(), i.problem]));
      expect(by).toEqual({ "bad.safetensors": "bad-header", "tiny.safetensors": "too-small", "half.safetensors.part": "partial" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
