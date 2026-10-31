# Verification - Build comfy-resolve (npm package)

## 2026-10-18

- Plan review only this round. Checks performed: HTTP HEAD on the three Manager JSON files
  (200, sizes recorded), one HF tree listing, one Civitai by-hash call, five npm 404 name checks,
  `wc -l` on the Python modules. PASS.
- Not verified: whether the Python `analyze()` output can be reproduced byte-for-byte (that is
  milestone M1's acceptance test).

## 2026-10-18 (later)

- `npx tsc --noEmit`: clean. `npx vitest run`: 31/31 pass (13 analyze-parity, 13 resolve-parity,
  5 unit). PASS.
- `npm run build`: dist/index.js + dist/cli.js + dist/index.d.ts. PASS.
- Smoke: `node dist/cli.js analyze dreamframe.json` (exit 0), `resolve klein_upscale.json --offline`
  (2 resolved, 1 unresolved, exit 3), `nodes windows_paths.json --offline` with an empty cache
  (all unresolved, exit 3 - expected: offline mode has no Manager data until one online run). PASS.
- Not yet verified: live HF/Civitai search paths (M3), download/verify (M4), publish (M5).
- M4: 38/38 tests (download resume verified byte-exact via Buffer.equals; hash mismatch deletes
  the file; 404 reported; auto skipped; Civitai token only sent to civitai URLs; verify flags
  bad-header/too-small/partial and ignores put_* placeholders). PASS.
- Found and fixed: a 4-5 s "stall" in two tests was vitest deep-equality on 3 MB Buffers, not the
  downloader (instrumented phases: fetch→pipeline→digest→rename = 25 ms).
- GitHub Actions run 1 (commit 4deb610): success on Node 20 and 22. PASS.
- M3 live smoke (2026-10-18, real network, fresh cache dir): `resolve klein_upscale.json` took 3.3 s,
  fetched Manager model-list (289 KB) + extension-node-map (2.5 MB) with ETag meta, built the HF
  org index (79 KB), resolved the `ImageCASharpening+` pack live (cubiq/ComfyUI_essentials),
  and listed 6 HF candidates for the unresolved `qwen_3_8b.safetensors` (same-stem + browse).
  `candidates "Wan-Lighting\Wan2.1 - lightx2v_...rank256_bf16.safetensors"` returned the bundled
  exact hit (Kijai/WanVideo_comfy) in 1 s plus 5 browse guesses. PASS.
- Live Civitai path exercised only indirectly (no civitai hit in that run). PARTIAL.

## 2026-10-31 - M5

- prepublishOnly ran typecheck + 38/38 tests + tsup build in the publish; tarball 95.7 kB,
  9 files (LICENSE, README, data/lookup.json, dist/*). PASS.
- `npm publish` returned `+ comfy-resolve@0.1.0`. PASS.
- `npm view comfy-resolve version` -> `0.0.0-stage` (staged-publishing stub); 0.1.0 not yet
  installable at the time of writing. PENDING - re-check with `npm view comfy-resolve versions`.
- Tag v0.1.0 pushed: `git ls-remote --tags origin` lists refs/tags/v0.1.0 -> d796431. PASS.
- Not done: GitHub release, deleting the token on npmjs after use (token has no Bypass 2FA, so it
  is of limited use for future publishes anyway).
