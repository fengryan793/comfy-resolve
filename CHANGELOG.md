# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

First release.

### Added
- `analyze`: parse ComfyUI workflows in UI and API format; list model files (Windows
  folder prefixes normalised, sub-folders kept), custom-node classes, cloud-API nodes,
  `selfHostable` flag and `LoadImage` presence.
- `resolve`: layered sources - bundled verified table, user overrides, ComfyUI-Manager
  `model-list.json` / `extension-node-map.json` (cached with ETag + 24 h TTL), Hugging Face
  org file index, Hugging Face search, Civitai search - producing a versioned manifest
  (JSON and TSV) with ranked candidates for anything unresolved.
- `nodes`: custom-node repos only.
- `candidates`: ranked HF / Civitai guesses for one filename, including community-renamed files.
- `download`: resumable `.part` downloads with Range, SHA-256 verification when known,
  concurrency, per-host tokens (`HF_TOKEN`, `CIVITAI_API_KEY`), dry-run.
- `script`: bash equivalent for GPU boxes without Node (`hf download` fast path, `curl -C -`
  fallback, custom-node cloning).
- `verify`: flag truncated weights, leftover `.part` files and safetensors with bad headers.
- Library API: `loadWorkflow`, `analyze`, `createResolver`, `downloadManifest`, `toScript`,
  `verifyModelsDir`, pluggable `ModelSource` / `NodeSource`.

[0.1.0]: https://github.com/fengryan793/comfy-resolve/releases/tag/v0.1.0
