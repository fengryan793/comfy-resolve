import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { analyze, createResolver, loadWorkflow, toTsv, type Manifest } from "../src/index.js";
import type { FileIndex, ManagerData } from "../src/index.js";
import { GOLDEN, HTTP, WORKFLOWS, goldenNames, readJson } from "./helpers.js";

/** tools/autopilot/resolver.py::make_plan(deep=False) output. */
interface PyPlan {
  self_hostable: boolean;
  api_nodes: string[];
  nodes: { class: string; url: string; name: string }[];
  unresolved_nodes: string[];
  droppable_missing: string[];
  models: ({ file: string; dest: string; via: string } & { hf?: string; path?: string; url?: string; civitai?: number; gb?: number })[];
  unresolved_models: { file: string; dest: string }[];
  total_gb: number;
}

/** The pack folders the Python provisioner pre-installs; make_plan() skips them. */
const BOOTSTRAP = [
  "ComfyUI-Manager", "ComfyUI-VideoHelperSuite", "ComfyUI-WanVideoWrapper", "ComfyUI-KJNodes",
  "ComfyUI-GGUF", "ComfyUI_InstantID", "ComfyUI-LatentSyncWrapper", "ComfyUI-Frame-Interpolation",
  "ComfyUI-Impact-Pack", "ComfyUI_wav2lip", "ComfyUI-Custom-Scripts", "ComfyUI-Easy-Use",
  "comfyui-reactor-node",
];

const VIA: Record<string, string> = { lookup: "bundled", "manager-db": "manager", "org-index": "hf-index" };

async function offlineResolver() {
  const managerData: ManagerData = {
    modelList: await readJson(join(HTTP, "model-list.json")),
    nodeMap: await readJson(join(HTTP, "extension-node-map.json")),
  };
  const index = await readJson<FileIndex>(join(HTTP, "org_file_index.json"));
  return createResolver({ offline: true, installedPacks: BOOTSTRAP, manager: { data: managerData }, hf: { index } });
}

describe("offline resolve matches the Python plan on the corpus", async () => {
  const names = await goldenNames();
  const resolver = await offlineResolver();
  for (const name of names) {
    it(name, async () => {
      const req = analyze(await loadWorkflow(join(WORKFLOWS, `${name}.json`)));
      const m: Manifest = await resolver.makeManifest(req, name);
      const py = await readJson<PyPlan>(join(GOLDEN, `${name}.plan.json`));
      expect(m.selfHostable).toBe(py.self_hostable);
      expect(m.customNodes.map((n) => n.repo).sort()).toEqual(py.nodes.map((n) => n.url).sort());
      expect(m.unresolvedNodes).toEqual(py.unresolved_nodes);
      expect(m.droppableMissing).toEqual(py.droppable_missing);
      expect(m.unresolvedModels.map((u) => u.ref).sort()).toEqual(py.unresolved_models.map((u) => u.file).sort());
      expect(m.models.map((r) => r.ref).sort()).toEqual(py.models.map((r) => r.file).sort());
      for (const pm of py.models) {
        const mine = m.models.find((r) => r.ref === pm.file);
        expect(mine, pm.file).toBeDefined();
        if (!mine) continue;
        expect(mine.dest).toBe(pm.dest);
        expect(mine.via).toBe(VIA[pm.via] ?? pm.via);
        if (pm.hf) { expect(mine.repo).toBe(pm.hf); expect(mine.path).toBe(pm.path ?? mine.basename); }
        if (pm.url && !pm.hf) expect(mine.url).toBe(pm.url);
        if (pm.civitai !== undefined) expect(mine.versionId).toBe(pm.civitai);
      }
      expect(m.totalBytes / 1e9).toBeCloseTo(py.total_gb, 1);
    });
  }
});

describe("manifest", () => {
  it("renders TSV with dest sub-folders kept", async () => {
    const resolver = await offlineResolver();
    const req = analyze(await loadWorkflow(join(WORKFLOWS, "dreamframe.json")));
    const m = await resolver.makeManifest(req, "dreamframe");
    const tsv = toTsv(m);
    expect(tsv.split("\n")[0]).toMatch(/^# comfy-resolve manifest v1 for dreamframe/);
    expect(tsv).toContain("\tComfy-Org/");
    expect(m.models.length).toBe(7);
  });

  it("returns an empty skeleton for API-only workflows", async () => {
    const resolver = await offlineResolver();
    const req = analyze(await loadWorkflow(join(WORKFLOWS, "anime_apionly.json")));
    const m = await resolver.makeManifest(req, "anime");
    expect(m.selfHostable).toBe(false);
    expect(m.apiNodes).toContain("RH_Captioner");
    expect(m.models).toEqual([]);
  });

  it("honours overrides before catalogs and never clones core ComfyUI", async () => {
    const resolver = createResolver({
      offline: true,
      overrides: { "mystery.safetensors": { url: "https://example.com/m.safetensors", dest: "loras" } },
      manager: { data: { modelList: { models: [] }, nodeMap: { "https://github.com/comfyanonymous/ComfyUI": [["NativeThing"], {}] } } },
      hf: { index: {} },
    });
    const req = analyze({ format: "ui", raw: {}, nodes: [{ id: "1", type: "NativeThing", widgets: ["mystery.safetensors"], mode: 0 }] });
    const m = await resolver.makeManifest(req);
    expect(m.models[0]?.via).toBe("override");
    expect(m.models[0]?.url).toBe("https://example.com/m.safetensors");
    expect(m.models[0]?.dest).toBe("loras");
    expect(m.customNodes).toEqual([]);
    expect(m.unresolvedNodes).toEqual([]);
  });
});
