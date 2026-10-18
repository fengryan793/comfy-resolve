# comfy-resolve

> What does this ComfyUI workflow need, and where do I download it?

`comfy-resolve` reads a ComfyUI workflow JSON (editor export **or** API format) and tells you
which **model files** and **custom-node packs** it needs, finds a download source for each one
(bundled verified table → your overrides → ComfyUI-Manager catalogs → Hugging Face → Civitai),
and writes a manifest you can feed to a GPU box. Zero runtime dependencies, Node ≥ 20.

It deliberately does **not** run workflows - use the official
[`@comfyorg/sdk`](https://www.npmjs.com/package/@comfyorg/sdk) for that. This package fills the
step before it: a workflow you just downloaded → a machine that can actually run it.

## Install

```bash
npm i -g comfy-resolve      # CLI
npm i comfy-resolve         # library
```

## CLI

```bash
# what does it need?
comfy-resolve analyze wan_i2v.json

# where does each thing come from? (writes manifest.json, prints a summary)
comfy-resolve resolve wan_i2v.json -o manifest.json

# air-gapped / CI: bundled table + overrides + cache only
comfy-resolve resolve wan_i2v.json --offline --overrides my-models.json

# which custom node repos to git clone?
comfy-resolve nodes wan_i2v.json

# a file nobody could find: ranked HF / Civitai guesses, incl. renamed files
comfy-resolve candidates "Wan2.1 - lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors"

# fetch everything (resumable .part files, SHA-256 checked when known, 3 in parallel)
comfy-resolve download manifest.json --models-dir ~/ComfyUI/models

# no Node on the GPU box? print a bash script instead (uses `hf download` when present)
comfy-resolve script manifest.json --models-dir /workspace/ComfyUI/models > provision.sh

# find truncated / corrupt weights (size + safetensors header check)
comfy-resolve verify --models-dir ~/ComfyUI/models
```

Exit codes: `0` ok · `2` workflow uses cloud-API nodes (not self-hostable) · `3` something stayed unresolved (manifest still written).

Env: `HF_TOKEN` (gated repos), `CIVITAI_API_KEY` (NSFW / gated), `COMFY_RESOLVE_CACHE_DIR`.

### Overrides file

Same shape as the bundled table - keyed by filename, value says where it lives:

```json
{
  "myLora.safetensors":           { "url": "https://example.com/myLora.safetensors", "dest": "loras" },
  "wan_2.1_vae.safetensors":      { "hf": "Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "path": "split_files/vae/wan_2.1_vae.safetensors", "dest": "vae" },
  "epicrealism_naturalSinRC1.safetensors": { "civitai": 143906, "dest": "checkpoints" }
}
```

## Library

```ts
import { loadWorkflow, analyze, createResolver, toTsv } from "comfy-resolve";

const req = analyze(await loadWorkflow("wan_i2v.json"));
// req.models -> [{ ref, basename, subdir, loader, destGuess }], req.customNodes, req.apiNodes, req.selfHostable

const resolver = createResolver({ offline: false, installedPacks: ["ComfyUI-Manager"] });
const manifest = await resolver.makeManifest(req, "wan_i2v.json");
// manifest.models[i] -> { ...ref, via, source, url, repo?, path?, dest, sizeBytes?, sha256? }
// manifest.unresolvedModels[i].candidates -> ranked guesses
// manifest.customNodes -> [{ class, repo, pack }]
console.log(toTsv(manifest));
```

Every source is a small `ModelSource` / `NodeSource` object, so you can add your own
(an internal mirror, a company S3 bucket) with `createResolver({ modelSources: [...] })`.

## How resolution works

| order | source | what it knows | network |
|---|---|---|---|
| 1 | bundled table (`data/lookup.json`) | hand-verified downloads for common Wan / Flux / Qwen / LTX / SDXL files | no |
| 2 | `--overrides` | your own answers | no |
| 3 | ComfyUI-Manager `model-list.json` / `extension-node-map.json` | curated models, node class → repo | cached 24 h |
| 4 | Hugging Face org index | every weight file in ~30 well-known repos, by basename | built once, cached |
| 5 | Hugging Face search | exact basename in any public repo | live |
| 6 | Civitai search | exact filename, NSFW with token | live |

Windows-style references (`Wan-Lighting\Wan2.1 - lightx2v….safetensors`) are normalised and the
sub-folder is preserved in `dest`, so ComfyUI's loader dropdown still lists the file.

## Status

0.1.0 - analyze / resolve / nodes / candidates / download / script / verify. Next: learned
cache for live hits, hash-based lookup, then UI→API `convert`. See
`Documentation/build-comfy-resolve/Plan.md`.

## License

MIT © Ryan Feng
