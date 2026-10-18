/** Which ComfyUI JSON dialect a workflow file uses. */
export type WorkflowFormat = "ui" | "api";

/** One node, normalised across the UI and API formats. */
export interface GraphNode {
  id: string;
  type: string;
  /** Widget values in schema order (UI) or input values (API); strings are scanned for model refs. */
  widgets: unknown[];
  /** 0 = normal, 2 = muted, 4 = bypassed (UI format only). */
  mode: number;
}

export interface Graph {
  format: WorkflowFormat;
  nodes: GraphNode[];
  /** The raw parsed JSON, kept for converters that need links/inputs. */
  raw: unknown;
}

/** A model file reference found in a workflow widget. */
export interface ModelRef {
  /** The exact widget string, e.g. "Wan-Lighting\\Wan2.1 - lightx2v.safetensors". */
  ref: string;
  /** Bare filename with any folder prefix (Windows or POSIX) stripped. */
  basename: string;
  /** Folder prefix inside the models/<dest>/ dir, "" when none. */
  subdir: string;
  /** Node class that loads it, e.g. "UNETLoader". */
  loader: string;
  /** Best-guess models/ sub-folder from the loader type ("models" when unknown). */
  destGuess: string;
}

export interface Requirements {
  format: WorkflowFormat;
  nodeCount: number;
  /** Node classes that call hosted cloud APIs (workflow cannot be self-hosted). */
  apiNodes: string[];
  selfHostable: boolean;
  /** Node classes that need a custom-node pack installed. */
  customNodes: string[];
  models: ModelRef[];
  hasLoadImage: boolean;
}

export type ResolutionVia = "bundled" | "override" | "manager" | "hf-index" | "hf-search" | "civitai";

export interface Resolution {
  via: ResolutionVia;
  /** "auto" = the node pack downloads this file itself on first run; nothing to fetch. */
  source: "hf" | "civitai" | "url" | "auto";
  /** Direct download URL ("" for source "auto"). */
  url: string;
  /** For source "auto": which mechanism fetches it, e.g. "reactor-first-run". */
  auto?: string;
  /** Hugging Face repo id, when source is "hf". */
  repo?: string;
  /** Path inside the HF repo, when source is "hf". */
  path?: string;
  /** Civitai model-version id, when source is "civitai". */
  versionId?: number;
  /** models/ sub-folder to save into. */
  dest: string;
  sizeBytes?: number;
  sha256?: string;
  nsfw?: boolean;
  /** 2 = exact curated/override hit, 1 = exact filename match in a catalog, 0 = fuzzy. */
  confidence: 0 | 1 | 2;
}

export type ResolvedModel = ModelRef & Resolution;

export interface Candidate {
  url: string;
  label: string;
  source: "hf" | "civitai";
  nsfw?: boolean;
}

export interface UnresolvedModel extends ModelRef {
  candidates: Candidate[];
}

export interface NodeRepo {
  class: string;
  repo: string;
  /** Folder name under custom_nodes/, i.e. the last URL segment. */
  pack: string;
}

export interface Manifest {
  version: 1;
  generatedAt: string;
  workflow: string;
  selfHostable: boolean;
  apiNodes: string[];
  models: ResolvedModel[];
  unresolvedModels: UnresolvedModel[];
  customNodes: NodeRepo[];
  unresolvedNodes: string[];
  /** Missing nodes that are display/sink-only and can be dropped without changing outputs. */
  droppableMissing: string[];
  /** Sum of known sizes; 0 when nothing reported a size. */
  totalBytes: number;
}
