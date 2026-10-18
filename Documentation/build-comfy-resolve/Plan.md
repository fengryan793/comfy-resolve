# Plan - Build `comfy-resolve` (npm package)

## 2026-10-18 - v1 plan (for review before any code)

### 1. One-line pitch

`comfy-resolve` takes a ComfyUI workflow JSON and answers, offline-first and in seconds:
**which model files and custom-node packs it needs, where to download each one from, how big
they are, and then fetches and verifies them** — as a TypeScript library and a CLI.

```bash
npx comfy-resolve analyze  wf.json                 # what does it need?
npx comfy-resolve resolve  wf.json -o manifest.json # where does each thing come from?
npx comfy-resolve download manifest.json --models-dir ./ComfyUI/models
npx comfy-resolve verify   --models-dir ./ComfyUI/models
```

### 2. Why this and why now (from the research folder)

- No npm package does the *resolve* step. `@comfyorg/sdk` (official, v0.5.0, Node ≥22, MIT)
  only submits API-format workflows and fetches outputs; `@saintno/comfyui-sdk` and friends
  are also execution clients. ComfyUI-Manager's `cm-cli` cannot read a workflow file at all
  (verified in its docs: no command takes a workflow, none touches models).
- We already own a working implementation: `ai-short-video/tools/autopilot/`
  (`analyzer.py` 100 lines, `resolver.py` 632, `provisioner.py` 401, `runner.py` 626,
  `lookup_table.json` 69 entries, a 10-workflow golden regression suite). Every edge case in
  it came from a real failure on RunPod / Comfy Cloud.
- Dogfood: the autopilot UI, the RunPod provisioning scripts and the `comfy-workflow-search`
  skill all call this logic today; the package replaces that path.

### 3. Goals / non-goals

**Goals (v1 = 0.1.0)**
1. Parse both ComfyUI formats (UI "nodes/links" and API "{id: {class_type, inputs}}").
2. Extract requirements: model refs (with Windows `\` paths normalised, sub-folders kept),
   custom-node classes, cloud-API nodes (→ `selfHostable=false`), `LoadImage` presence.
3. Resolve each model ref to a download source, cheapest-first:
   bundled lookup table → user overrides → ComfyUI-Manager `model-list.json` →
   known-HF-org file index → live HF search (exact → same-stem → *browse fallback* for
   community-renamed files) → live Civitai search (exact → same-stem, NSFW-aware, token
   optional). Return a single best hit **and** a ranked candidate list.
4. Resolve each custom-node class to a git repo via Manager `extension-node-map.json`,
   skipping core (`comfyanonymous/ComfyUI`) and a configurable "already installed" set;
   classify unresolved nodes as *droppable* (preview/sink) or *blocking*.
5. Emit a versioned **manifest** (JSON, plus the tab-separated format our `.runpod/*.manifest`
   files already use) with dest sub-folder, URL, size and hash where known.
6. Download locally: streaming to `.part` + rename, HTTP Range resume, concurrency, SHA-256
   verification (HF LFS `sha256`, Civitai `files[].hashes.SHA256`), HF/Civitai tokens and a
   browser UA for Civitai, progress events. Also `--script` to print an equivalent bash
   (`hf download` / `curl`) for remote pods where Node is not installed.
7. Verify a models dir: size sanity + safetensors header parse (port of `integrity_scan`).
8. CLI with `--json`, `--offline`, `--overrides <file>`, `--cache-dir`, exit codes for CI.

**Phase 2 (0.2.x, after dogfooding)**
- `convert`: UI → API prompt using `/object_info` (port of `runner.convert` incl. Reroute,
  SetNode/GetNode, bypass mode 4, dict-style `widgets_values`, seed control widgets) and
  `repair`/`pruneToOutputs`; `setInputs()` helpers (override text prompts, bind N image slots).
  This is the bridge from "a workflow I downloaded" to something `@comfyorg/sdk` can run.
- Learned cache ("remember" successful live resolutions in `~/.cache/comfy-resolve/learned.json`).
- Hash-based lookup (`civitai /model-versions/by-hash`) when a local file exists but is unnamed.

**Non-goals**
- Running workflows, queue/history polling (use `@comfyorg/sdk`).
- RunPod / pod lifecycle, SSH, tunnels (stay in `ai-short-video/.runpod`).
- Any stealth / anti-bot / CAPTCHA logic; any NSFW policy beyond passing the user's token.
- A GUI.

### 4. Package design

**Name / repo / license**
- npm: `comfy-resolve` (confirmed free on 2026-10-18, as are `comfyresolve`, `comfy-manifest`).
- Repo: new, standalone, `~/Documents/comfy-resolve` (own git, own `Documentation/`).
  GitHub org/account: **open question** (fengryan793 vs heroku514).
- License: MIT (open question - default unless told otherwise).
- Runtime: Node ≥ 20 (built-in `fetch`, `node:crypto`, `util.parseArgs`), ESM-only, TypeScript
  strict. **Zero runtime dependencies**; dev: typescript, tsup, vitest, @types/node.

**Module layout**
```
src/
  index.ts            public API re-exports
  parse.ts            detectFormat(), parseWorkflow() -> Graph
  analyze.ts          analyze(graph) -> Requirements   (MODEL_EXTS, CORE_PREFIXES, API_PATTERNS, DROPPABLE, VIRTUAL)
  refs.ts             normBase(), normSubdir(), destByLoader()
  catalog/
    types.ts          Source interface, Resolution, Candidate
    bundled.ts        ships data/lookup.json (our 69 verified entries, grows over time)
    overrides.ts      user JSON {filename: {url|hf+path|civitai, dest}}
    manager.ts        model-list.json + extension-node-map.json, cached w/ ETag + 24h TTL
    hf.ts             org file index (INDEX_REPOS), searchFile(), tree listing, sha256/size
    civitai.ts        searchFile(), version -> download URL, hashes
  resolve.ts          resolveModel(), resolveNode(), makePlan() -> Manifest
  manifest.ts         Manifest v1 schema, read/write JSON + TSV
  download.ts         download(manifest, opts) with resume/verify/progress; toScript()
  verify.ts           verifyModelsDir(): size + safetensors header
  cli.ts              subcommands; bin "comfy-resolve"
data/lookup.json      bundled lookup table
test/
  fixtures/workflows/ 12+ workflows from our corpus (UI, API, Windows paths, SetNode/GetNode, bypass, api-only)
  fixtures/http/      recorded HF / Civitai / Manager responses (no network in unit tests)
  golden/             *.requirements.json, *.manifest.json snapshots (--bless to re-record)
```

**Core types (sketch)**
```ts
type ModelRef   = { ref: string; basename: string; subdir: string; loader: string; destGuess: string };
type Resolution = { via: 'bundled'|'override'|'manager'|'hf-index'|'hf-search'|'civitai';
                    source: 'hf'|'civitai'|'url'; url: string; repo?: string; path?: string;
                    dest: string; sizeBytes?: number; sha256?: string; nsfw?: boolean; confidence: 0|1|2 };
type Manifest   = { version: 1; workflow: string; selfHostable: boolean; apiNodes: string[];
                    models: (ModelRef & Resolution)[]; unresolvedModels: (ModelRef & {candidates: Candidate[]})[];
                    customNodes: {class: string; repo: string; pack: string}[];
                    unresolvedNodes: string[]; droppableMissing: string[]; totalBytes: number };
```

**CLI surface**
```
comfy-resolve analyze  <wf.json> [--json]
comfy-resolve resolve  <wf.json> [-o manifest.json] [--offline] [--overrides f] [--installed pack,...] [--json]
comfy-resolve nodes    <wf.json>                    # custom-node repos only
comfy-resolve download <manifest.json> --models-dir <dir> [--concurrency 3] [--only name] [--script]
comfy-resolve verify   --models-dir <dir>
comfy-resolve candidates <filename>                 # ranked HF/Civitai URLs for one file
```
Env: `HF_TOKEN`, `CIVITAI_API_KEY`, `COMFY_RESOLVE_CACHE_DIR`.

### 5. Milestones (each ends with a Verification entry)

| # | Deliverable | Verified by |
|---|---|---|
| M0 | Repo scaffold: package.json, tsconfig, tsup, vitest, CI (lint+test on Node 20/22), README stub, MIT, this Documentation folder moved in | `npm run build && npm test` green in CI |
| M1 | `parse` + `analyze` + `refs` | golden `requirements.json` for 12 fixture workflows equals the Python `analyze()` output on the same files (run both, diff) |
| M2 | Offline catalog: bundled + overrides + Manager (from recorded fixtures) + HF org index; `resolve --offline` | golden manifests for the 10-corpus match Python `make_plan(deep=False)` modulo field names |
| M3 | Live sources: HF search w/ browse fallback, Civitai search; `candidates` command | recorded-fixture unit tests + one opt-in live test (`LIVE=1`) that resolves `wan_2.1_vae.safetensors` and the renamed `lightx2v` LoRA case |
| M4 | `manifest` (JSON + TSV) + `download` (resume, verify, progress, `--script`) + `verify` | download a ~250 MB VAE to a temp dir, kill mid-way, resume, hash matches HF LFS sha256; `verify` flags a truncated file |
| M5 | CLI polish, `--json`, exit codes, README with examples, CHANGELOG, `npm publish 0.1.0` (dry-run first) | `npx comfy-resolve@0.1.0 analyze` works from a clean machine/dir |
| M6 | Dogfood: autopilot `do_analyze`/`do_provision` shell out to the CLI (or read its manifest); `comfy-workflow-search` skill calls `analyze` on each download | one real workflow provisioned on a pod end-to-end via the new path; Findings updated |
| M7 (phase 2) | `convert` + `setInputs` | golden API prompts equal Python `convert+repair` output for the 10-corpus |

Rough effort: M0-M5 ≈ 5-7 working days; M6 1-2 days; M7 ≈ 1 week.

### 6. Porting notes (what to keep exactly, what to change)

Keep verbatim (they encode fixed bugs): `MODEL_EXTS`; `CORE_PREFIXES` (move to data file, add
the ability to pass `/object_info` to make it exact); `API_PATTERNS` incl. the `Minimax(?!H3)`
exclusion; `DROPPABLE`/`VIRTUAL`; `norm_base`/`norm_subdir` Windows handling; `DEST_BY_NODE`;
Manager `save_path` "default" substitution; skip of the core ComfyUI repo in node resolution;
`find_hf_urls` term ladder (base → stem → spaced stem → 3/2/1 leading tokens) and the browse
fallback; Civitai UA + bearer + `nsfw=true`; `.part`-then-rename download; safetensors header check.

Change: layered sources become a `Source[]` array (pluggable, testable); on-disk cache gets
ETag/TTL instead of "forever"; D1 "learned store" becomes an optional local JSON cache; every
network call gets a timeout + retry with jitter; sizes/hashes are read from HF tree API and
Civitai `files[]` so the manifest can report total bytes without the hand-typed `gb` field.

### 7. Risks

- HF search matches repo names, not file names → mitigated by org index + browse fallback
  (already proven); document that `candidates` may need a human pick.
- Civitai rate limits / 403 without UA; tokens needed for NSFW → documented, graceful "unresolved".
- Manager data files are 0.3 / 2.5 / 3.1 MB → lazy-load, cache 24 h, `--offline` never fetches.
- Same basename in several HF repos → first-wins today; manifest records `confidence` and
  `candidates` so callers can override.
- Scope creep into "run the workflow" → hard non-goal; point to `@comfyorg/sdk`.

### 8. Open questions for Ryan

1. GitHub account for the public repo: `fengryan793` or `heroku514`? (npm account likewise.)
2. Repo location `~/Documents/comfy-resolve` OK?
3. MIT license OK?
4. Ship `convert` (UI→API) in 0.1.0, or keep it for 0.2 as planned above?
