# Progress - Build comfy-resolve (npm package)

## 2026-10-18

- Created folder and four files; reading the Python autopilot source before writing the plan.
- Read `analyzer.py`, `resolver.py`, `provisioner.py`, the head of `runner.py`, `lookup_table.json`,
  `tests/regression.py` + README, `.runpod/models.manifest`.
- Verified Manager data-file URLs/sizes, HF tree API fields, Civitai by-hash endpoint, npm name
  availability; read `@comfyorg/sdk` README (registry) and `cm-cli` docs.
- Wrote Plan.md v1 (goals, design, CLI, milestones M0-M7, risks, 4 open questions) and Findings.md.
- No code written; no repo created yet.

## 2026-10-18 (later) - M0, M1, M2 done

- M0: repo at ~/Documents/comfy-resolve, git identity Ryan Feng <fengryan793@users.noreply.github.com>,
  package.json (ESM, Node >=20, zero runtime deps), tsconfig strict, tsup (index + cli), vitest,
  GitHub Actions CI (Node 20/22), MIT, README. GitHub repo fengryan793/comfy-resolve created via the
  github_ryan MCP endpoint.
- Fixtures: 14 workflows copied from ai-short-video (10-corpus + h3_multishot_aio + red_h3_5s_api +
  windows_paths); Python `analyze()` / `make_plan(deep=False)` recorded as golden for 13 of them
  (the Python analyzer crashes on the API file with a `_comment` key; ours tolerates it). Trimmed
  Manager model-list / node-map and HF org-index fixtures recorded for offline tests.
- M1: src/parse.ts, src/refs.ts, src/analyze.ts - parity with Python on all 13 golden files.
- M2: src/http.ts, src/cache.ts (ETag + 24h TTL), src/catalog/{types,bundled,overrides,manager,hf,civitai}.ts,
  src/resolve.ts (Resolver, makeManifest), src/manifest.ts (JSON + TSV). Added "auto" entries
  (pack downloads the file itself, e.g. ReActor's GFPGAN/CodeFormer) to keep parity.
- CLI: analyze / resolve / nodes / candidates with --json, --offline, --overrides, --installed,
  --cache-dir, -o, --tsv; exit codes 0/2/3.
- M4: src/download.ts (streamed .part + rename, Range resume, 416/200-ignores-Range handling,
  SHA-256 on the fly or post-hoc when resumed, concurrency, per-host tokens, dry-run, bash
  `toScript()` with `hf download` fast path and node-pack cloning), src/verify.ts (size +
  safetensors header). CLI gained download / script / verify. 7 new tests against a local
  Range-capable HTTP server; first CI run on GitHub was green.
