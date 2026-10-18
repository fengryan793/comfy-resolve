# Findings - Build comfy-resolve (npm package)

## 2026-10-18 - facts gathered while planning

### Existing implementation (ai-short-video/tools/autopilot)
- `analyzer.py` (≈100 lines): format detection (UI vs API), `MODEL_EXTS`, `CORE_PREFIXES`
  (≈120 prefixes), `API_PATTERNS` regex (cloud nodes; excludes local MiniMax-H3), `DROPPABLE`,
  `VIRTUAL`; `analyze()` returns format/node_count/api_nodes/self_hostable/custom_nodes/models/has_load_image.
- `resolver.py` (632): layered `resolve_model()` = lookup → D1 store → Manager model-list →
  HF org index (30 repos) → HF search → Civitai search; `resolve_node()` via Manager
  `extension-node-map.json`; `make_plan()`; `find_hf_urls()` with term ladder + browse
  fallback for renamed files; `find_civitai_urls()`; `DEST_BY_NODE`; `BOOTSTRAP_NODES`.
- `provisioner.py` (401): SSH-based installs/downloads on a pod, `hf download` fast path,
  `.apdl` staging dir, `integrity_scan()` (safetensors header), `verify_nodes()` vs `/object_info`.
- `runner.py` (626): UI→API `convert()` (Reroute, SetNode/GetNode, bypass mode 4, dict
  widgets, seed control widgets), `repair()`, `prune_to_outputs()`, `override_text_prompts()`,
  queue/wait/run_with_repair.
- `lookup_table.json`: 69 curated entries `{hf, path, dest, gb}` or `{civitai}`/`{url}`.
- `tests/regression.py`: 10-workflow corpus, frozen `object_info.json`, golden `*.plan.json`
  and `*.prompt.json`, `--bless`, seeds masked. Corpus lives in `runninghub-workflows/`.
- Fixture supply: 59 JSON under `runninghub-workflows/`, 36 under `comfyui_workflows_downloaded/`,
  8 Comfy Cloud exports under `comfy_cloud_workflows/`.
- `.runpod/models.manifest` format: `<dest>\t<repo>\t<repo-path>\t<dest-file>` with `#` comments.

### External data sources (verified live 2026-10-18)
- ComfyUI-Manager now lives at `Comfy-Org/ComfyUI-Manager` (old `ltdrdata/...` URLs still 200):
  `model-list.json` 289 KB, `extension-node-map.json` 2.53 MB, `custom-node-list.json` 3.08 MB.
- HF tree API `GET /api/models/{repo}/tree/main/{path}` returns `size`, `lfs.sha256`, `xetHash`
  per file → manifest can carry exact sizes and hashes.
- Civitai `GET /api/v1/model-versions/by-hash/{sha256}` responds (404 on fake hash) → usable for
  phase-2 hash lookups; `files[].hashes.SHA256` available on search results.

### Competition / adjacent tools
- `@comfyorg/sdk` 0.5.0: MIT, Node ≥22, deps zod/hash-wasm/eventsource-parser; README headings are
  all about running workflows (`run/submit/subscribe`, assets, progress, outputs). No model
  resolution, no custom-node install, no UI→API conversion. → complementary.
- `cm-cli` (ComfyUI-Manager CLI): install/uninstall/update/snapshot of *named* packs; no command
  reads a workflow file; nothing for models.
- npm names `comfy-resolve`, `comfyresolve`, `comfy-manifest`, `comfy-assets` all 404 (free).
