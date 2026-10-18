#!/usr/bin/env node
import { parseArgs } from "node:util";
import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { analyze } from "./analyze.js";
import { loadOverrides } from "./catalog/overrides.js";
import { formatBytes, toTsv, writeManifest, destDir } from "./manifest.js";
import { loadWorkflow } from "./parse.js";
import { makeModelRef } from "./refs.js";
import { createResolver, type ResolverOptions } from "./resolve.js";
import type { Manifest, Requirements } from "./types.js";

const USAGE = `comfy-resolve - what does this ComfyUI workflow need, and where do I get it?

Usage:
  comfy-resolve analyze    <workflow.json> [--json]
  comfy-resolve resolve    <workflow.json> [-o manifest.json] [--tsv file] [--offline]
                           [--overrides file] [--installed pack,pack] [--json]
  comfy-resolve nodes      <workflow.json> [--json]
  comfy-resolve candidates <model-filename> [--limit 6] [--json]

Options:
  --offline          never touch the network (bundled table, overrides, cache only)
  --overrides <f>    JSON {"file.safetensors": {"url"|"hf"+"path"|"civitai", "dest"}}
  --installed <l>    comma list of custom_nodes folders already present (left out of the manifest)
  --cache-dir <d>    where catalogs are cached (default ~/.cache/comfy-resolve)
  --json             machine-readable output
  -h, --help         this help

Env: HF_TOKEN, CIVITAI_API_KEY, COMFY_RESOLVE_CACHE_DIR

Exit codes: 0 ok, 1 usage/error, 2 workflow needs cloud-API nodes (not self-hostable),
            3 some models or nodes are unresolved (manifest still written)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    json: { type: "boolean" },
    offline: { type: "boolean" },
    overrides: { type: "string" },
    installed: { type: "string" },
    "cache-dir": { type: "string" },
    out: { type: "string", short: "o" },
    tsv: { type: "string" },
    limit: { type: "string" },
  },
});

const [cmd, target] = positionals;

function die(msg: string, code = 1): never {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

async function resolverFromFlags(): Promise<ReturnType<typeof createResolver>> {
  const opts: ResolverOptions = {};
  if (values.offline) opts.offline = true;
  if (values.overrides) opts.overrides = await loadOverrides(values.overrides);
  if (values.installed) opts.installedPacks = values.installed.split(",").map((s) => s.trim()).filter(Boolean);
  if (values["cache-dir"]) opts.cacheDir = values["cache-dir"];
  return createResolver(opts);
}

function printRequirements(req: Requirements, file: string): void {
  const out: string[] = [];
  out.push(`${basename(file)}: ${req.format.toUpperCase()} format, ${req.nodeCount} nodes, ${req.selfHostable ? "self-hostable" : "NOT self-hostable"}`);
  if (req.apiNodes.length) out.push(`  cloud-API nodes: ${req.apiNodes.join(", ")}`);
  out.push(`  models (${req.models.length}):`);
  for (const m of req.models) out.push(`    ${m.destGuess.padEnd(16)} ${m.ref}  [${m.loader}]`);
  out.push(`  custom nodes (${req.customNodes.length}): ${req.customNodes.join(", ") || "-"}`);
  out.push(`  input image: ${req.hasLoadImage ? "yes (LoadImage)" : "no"}`);
  process.stdout.write(out.join("\n") + "\n");
}

function printManifest(m: Manifest): void {
  const out: string[] = [];
  out.push(`${m.workflow}: ${m.selfHostable ? "self-hostable" : "NOT self-hostable - cloud nodes: " + m.apiNodes.join(", ")}`);
  if (m.models.length) {
    out.push(`  resolved models (${m.models.length}, ${formatBytes(m.totalBytes)}):`);
    for (const r of m.models) {
      const src = r.source === "auto" ? `auto (${r.auto})` : r.source === "hf" ? `${r.repo}/${r.path}` : r.url;
      out.push(`    ${destDir(r).padEnd(20)} ${r.basename}\n      <- ${src}  [${r.via}${r.sizeBytes ? ", " + formatBytes(r.sizeBytes) : ""}]`);
    }
  }
  if (m.unresolvedModels.length) {
    out.push(`  UNRESOLVED models (${m.unresolvedModels.length}):`);
    for (const u of m.unresolvedModels) {
      out.push(`    ${u.destGuess.padEnd(20)} ${u.ref}`);
      for (const c of u.candidates) out.push(`      ? ${c.url}\n        ${c.label}`);
    }
  }
  if (m.customNodes.length) {
    out.push(`  custom node packs (${m.customNodes.length}):`);
    for (const n of m.customNodes) out.push(`    ${n.pack.padEnd(32)} ${n.repo}  (for ${n.class})`);
  }
  if (m.droppableMissing.length) out.push(`  droppable (display-only, no repo found): ${m.droppableMissing.join(", ")}`);
  if (m.unresolvedNodes.length) out.push(`  UNRESOLVED nodes: ${m.unresolvedNodes.join(", ")}`);
  process.stdout.write(out.join("\n") + "\n");
}

async function main(): Promise<number> {
  if (values.help || !cmd) { process.stdout.write(USAGE + "\n"); return cmd ? 0 : 1; }
  switch (cmd) {
    case "analyze": {
      if (!target) die("analyze: missing <workflow.json>\n\n" + USAGE);
      const req = analyze(await loadWorkflow(target));
      if (values.json) process.stdout.write(JSON.stringify(req, null, 2) + "\n");
      else printRequirements(req, target);
      return req.selfHostable ? 0 : 2;
    }
    case "resolve": {
      if (!target) die("resolve: missing <workflow.json>\n\n" + USAGE);
      const req = analyze(await loadWorkflow(target));
      const resolver = await resolverFromFlags();
      const m = await resolver.makeManifest(req, basename(target));
      if (values.out) await writeManifest(values.out, m);
      if (values.tsv) await writeFile(values.tsv, toTsv(m));
      if (values.json) process.stdout.write(JSON.stringify(m, null, 2) + "\n");
      else printManifest(m);
      if (!m.selfHostable) return 2;
      return m.unresolvedModels.length || m.unresolvedNodes.length ? 3 : 0;
    }
    case "nodes": {
      if (!target) die("nodes: missing <workflow.json>\n\n" + USAGE);
      const req = analyze(await loadWorkflow(target));
      const resolver = await resolverFromFlags();
      const m = await resolver.makeManifest({ ...req, models: [] }, basename(target));
      if (values.json) process.stdout.write(JSON.stringify({ customNodes: m.customNodes, unresolvedNodes: m.unresolvedNodes, droppableMissing: m.droppableMissing }, null, 2) + "\n");
      else {
        for (const n of m.customNodes) process.stdout.write(`${n.pack.padEnd(32)} ${n.repo}\n`);
        if (m.unresolvedNodes.length) process.stdout.write(`UNRESOLVED: ${m.unresolvedNodes.join(", ")}\n`);
      }
      return m.unresolvedNodes.length ? 3 : 0;
    }
    case "candidates": {
      if (!target) die("candidates: missing <model-filename>\n\n" + USAGE);
      const resolver = await resolverFromFlags();
      const ref = makeModelRef(target, "");
      const best = await resolver.resolveModel(ref);
      const list = await resolver.candidates(ref, Number(values.limit ?? 6));
      if (values.json) process.stdout.write(JSON.stringify({ best, candidates: list }, null, 2) + "\n");
      else {
        if (best) process.stdout.write(`best: ${best.url || "auto:" + best.auto}  [${best.via}]\n`);
        for (const c of list) process.stdout.write(`  ${c.url}\n    ${c.label}\n`);
        if (!best && !list.length) process.stdout.write("no candidates found\n");
      }
      return best || list.length ? 0 : 3;
    }
    default:
      die(`unknown command "${cmd}"\n\n` + USAGE);
  }
}

main().then((code) => process.exit(code), (err: unknown) => die(err instanceof Error ? err.message : String(err)));
