import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { analyze, loadWorkflow, normBase, normSubdir, parseWorkflow } from "../src/index.js";
import { GOLDEN, WORKFLOWS, goldenNames, readJson } from "./helpers.js";

/** Shape of tools/autopilot/analyzer.py::analyze() output, our parity reference. */
interface PyRequirements {
  format: "ui" | "api";
  node_count: number;
  api_nodes: string[];
  self_hostable: boolean;
  custom_nodes: string[];
  models: { file: string; node: string }[];
  has_load_image: boolean;
}

describe("analyze() matches the Python reference on the corpus", async () => {
  const names = await goldenNames();
  expect(names.length).toBeGreaterThanOrEqual(12);
  for (const name of names) {
    it(name, async () => {
      const graph = await loadWorkflow(join(WORKFLOWS, `${name}.json`));
      const req = analyze(graph);
      const py = await readJson<PyRequirements>(join(GOLDEN, `${name}.requirements.json`));
      expect(req.format).toBe(py.format);
      expect(req.nodeCount).toBe(py.node_count);
      expect(req.apiNodes).toEqual(py.api_nodes);
      expect(req.selfHostable).toBe(py.self_hostable);
      expect(req.customNodes).toEqual(py.custom_nodes);
      expect(req.models.map((m) => ({ file: m.ref, node: m.loader }))).toEqual(py.models);
      expect(req.hasLoadImage).toBe(py.has_load_image);
    });
  }
});

describe("parse", () => {
  it("accepts API-format files with non-node metadata keys", async () => {
    const graph = await loadWorkflow(join(WORKFLOWS, "red_h3_5s_api.json"));
    expect(graph.format).toBe("api");
    expect(graph.nodes.every((n) => n.type.length > 0)).toBe(true);
    const req = analyze(graph);
    expect(req.models.length).toBeGreaterThan(0);
  });

  it("detects formats from values", () => {
    expect(parseWorkflow({ nodes: [], links: [] }).format).toBe("ui");
    expect(parseWorkflow({ "1": { class_type: "KSampler", inputs: {} } }).format).toBe("api");
    expect(() => parseWorkflow([])).toThrow();
  });
});

describe("refs", () => {
  it("normalises Windows folder prefixes", () => {
    const ref = "Wan-Lighting\\Wan2.1 - lightx2v_I2V_14B_480p.safetensors";
    expect(normBase(ref)).toBe("Wan2.1 - lightx2v_I2V_14B_480p.safetensors");
    expect(normSubdir(ref)).toBe("Wan-Lighting");
    expect(normSubdir("wan_2.1_vae.safetensors")).toBe("");
    expect(normBase("loras/sub/foo.safetensors")).toBe("foo.safetensors");
  });

  it("keeps the first loader when the same file appears twice", () => {
    const g = parseWorkflow({ nodes: [
      { id: 1, type: "VAELoader", widgets_values: ["x.safetensors"] },
      { id: 2, type: "LoraLoader", widgets_values: ["x.safetensors", 1, 1] },
    ] });
    const req = analyze(g);
    expect(req.models).toHaveLength(1);
    expect(req.models[0]?.loader).toBe("VAELoader");
    expect(req.models[0]?.destGuess).toBe("vae");
  });
});
