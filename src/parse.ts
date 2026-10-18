import { readFile } from "node:fs/promises";
import type { Graph, GraphNode, WorkflowFormat } from "./types.js";

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * ComfyUI saves two dialects:
 *  - "ui":  the editor export, `{ nodes: [...], links: [...] }`
 *  - "api": the /prompt payload, `{ "<id>": { class_type, inputs } }`
 */
export function detectFormat(data: unknown): WorkflowFormat {
  if (!isDict(data)) throw new Error("unrecognized workflow: top level is not an object");
  return Array.isArray(data["nodes"]) ? "ui" : "api";
}

/** Parse an already-loaded workflow JSON value into a normalised Graph. */
export function parseWorkflow(data: unknown): Graph {
  const format = detectFormat(data);
  const d = data as Dict;
  const nodes: GraphNode[] = [];
  if (format === "ui") {
    for (const n of d["nodes"] as unknown[]) {
      if (!isDict(n)) continue;
      const wv = n["widgets_values"];
      const widgets = Array.isArray(wv) ? wv : isDict(wv) ? Object.values(wv) : [];
      nodes.push({
        id: String(n["id"] ?? nodes.length),
        type: typeof n["type"] === "string" ? n["type"] : "",
        widgets,
        mode: typeof n["mode"] === "number" ? n["mode"] : 0,
      });
    }
  } else {
    for (const [id, v] of Object.entries(d)) {
      if (!isDict(v)) continue;
      const inputs = v["inputs"];
      nodes.push({
        id,
        type: typeof v["class_type"] === "string" ? v["class_type"] : "",
        widgets: isDict(inputs) ? Object.values(inputs) : [],
        mode: 0,
      });
    }
  }
  return { format, nodes, raw: data };
}

/** Parse a workflow from JSON text. */
export function parseWorkflowText(text: string): Graph {
  return parseWorkflow(JSON.parse(text));
}

/** Read and parse a workflow file. */
export async function loadWorkflow(path: string): Promise<Graph> {
  return parseWorkflowText(await readFile(path, "utf8"));
}
