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
