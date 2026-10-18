import { cachedJson, type CachedJsonOptions } from "../cache.js";
import type { ModelRef, Resolution } from "../types.js";
import type { ModelSource, NodeSource } from "./types.js";

const BASE = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main";
export const MODEL_LIST_URL = `${BASE}/model-list.json`;
export const NODE_MAP_URL = `${BASE}/extension-node-map.json`;

export interface ManagerModel {
  filename?: string;
  url?: string;
  save_path?: string;
  name?: string;
  type?: string;
  base?: string;
  size?: string;
}

/** extension-node-map.json: { gitUrl: [[nodeClass, ...], { meta }] } */
export type NodeMap = Record<string, [string[], Record<string, unknown>?]>;

export interface ManagerData {
  modelList?: { models?: ManagerModel[] } | null;
  nodeMap?: NodeMap | null;
}

export interface ManagerOptions extends CachedJsonOptions {
  /** Pre-loaded data (tests, air-gapped use). Skips fetching whatever is provided. */
  data?: ManagerData;
}

/** ComfyUI-Manager's public catalogs: curated model list + node-class -> repo map. */
export class ManagerCatalog implements ModelSource, NodeSource {
  readonly name = "manager";
  private models?: Promise<ManagerModel[]>;
  private nodes?: Promise<NodeMap>;
  private byClass?: Map<string, string>;

  constructor(private readonly opts: ManagerOptions = {}) {}

  private modelList(): Promise<ManagerModel[]> {
    if (!this.models) {
      this.models = (async () => {
        const data = this.opts.data?.modelList !== undefined
          ? this.opts.data.modelList
          : await cachedJson<{ models?: ManagerModel[] }>(MODEL_LIST_URL, "model-list.json", this.opts);
        return data?.models ?? [];
      })();
    }
    return this.models;
  }

  private nodeMap(): Promise<NodeMap> {
    if (!this.nodes) {
      this.nodes = (async () => {
        const data = this.opts.data?.nodeMap !== undefined
          ? this.opts.data.nodeMap
          : await cachedJson<NodeMap>(NODE_MAP_URL, "extension-node-map.json", this.opts);
        return data ?? {};
      })();
    }
    return this.nodes;
  }

  async resolve(ref: ModelRef): Promise<Resolution | null> {
    for (const m of await this.modelList()) {
      if (m.filename === ref.basename && m.url) {
        // Manager writes "default/<sub>" for the save path; "default" means the loader's folder.
        const dest = (m.save_path ?? ref.destGuess).replace("default", ref.destGuess);
        return { via: "manager", source: "url", url: m.url, dest, confidence: 1 };
      }
    }
    return null;
  }

  async resolveNode(className: string): Promise<string | null> {
    if (!this.byClass) {
      this.byClass = new Map();
      for (const [url, entry] of Object.entries(await this.nodeMap())) {
        const names = Array.isArray(entry) ? entry[0] : [];
        for (const n of names) if (!this.byClass.has(n)) this.byClass.set(n, url);
      }
    }
    return this.byClass.get(className) ?? null;
  }
}
