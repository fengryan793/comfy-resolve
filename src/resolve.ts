import { DROPPABLE } from "./analyze.js";
import { bundledSource, type LookupTable } from "./catalog/bundled.js";
import { CivitaiCatalog } from "./catalog/civitai.js";
import { HfCatalog, type HfOptions } from "./catalog/hf.js";
import { ManagerCatalog, type ManagerOptions } from "./catalog/manager.js";
import { overrideSource } from "./catalog/overrides.js";
import type { ModelSource, NodeSource } from "./catalog/types.js";
import type { Candidate, Manifest, ModelRef, NodeRepo, Requirements, Resolution } from "./types.js";

/** Core ComfyUI itself shows up in the node map; it is never something to clone into custom_nodes/. */
const CORE_REPO = /github\.com\/comfyanonymous\/ComfyUI\/?$/i;

export interface ResolverOptions {
  /** Never hit the network: only bundled table, overrides, and whatever is already cached. */
  offline?: boolean;
  /** Parsed overrides table (see loadOverrides). Consulted right after the bundled table. */
  overrides?: LookupTable;
  /** custom_nodes/ folder names already present; their repos are left out of the manifest. */
  installedPacks?: Iterable<string>;
  cacheDir?: string;
  hfToken?: string;
  civitaiToken?: string;
  fetchImpl?: typeof fetch;
  /** Replace the default source chain entirely (tests, custom catalogs). */
  modelSources?: ModelSource[];
  nodeSources?: NodeSource[];
  manager?: ManagerOptions;
  hf?: HfOptions;
  /** How many candidate URLs to collect for each unresolved model (0 disables). */
  candidateLimit?: number;
}

export class Resolver {
  readonly modelSources: ModelSource[];
  readonly nodeSources: NodeSource[];
  private readonly installed: Set<string>;
  private readonly candidateLimit: number;

  constructor(private readonly opts: ResolverOptions = {}) {
    const offline = opts.offline ?? false;
    const common = { ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), offline };
    const manager = new ManagerCatalog({ ...common, ...(opts.manager ?? {}) });
    const hf = new HfCatalog({ ...common, ...(opts.hfToken ? { token: opts.hfToken } : {}), ...(opts.hf ?? {}) });
    const civitai = new CivitaiCatalog({ ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.civitaiToken ? { token: opts.civitaiToken } : {}), offline });
    const hfSearch: ModelSource = { name: "hf-search", resolve: (ref) => hf.searchFile(ref) };
    this.modelSources = opts.modelSources ?? [
      bundledSource(),
      ...(opts.overrides ? [overrideSource(opts.overrides)] : []),
      manager,
      hf,
      ...(offline ? [] : [hfSearch, civitai]),
    ];
    this.nodeSources = opts.nodeSources ?? [manager];
    this.installed = new Set(opts.installedPacks ?? []);
    this.candidateLimit = opts.candidateLimit ?? (offline ? 0 : 6);
  }

  /** First source that knows the file wins; sources are ordered cheapest-first. */
  async resolveModel(ref: ModelRef): Promise<Resolution | null> {
    for (const s of this.modelSources) {
      const r = await s.resolve(ref);
      if (r) return r;
    }
    return null;
  }

  async candidates(ref: ModelRef, limit = this.candidateLimit || 6): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const s of this.modelSources) {
      if (!s.candidates || out.length >= limit) continue;
      out.push(...(await s.candidates(ref, limit - out.length)));
    }
    return out;
  }

  /** Git repo providing a node class, or null. */
  async resolveNode(className: string): Promise<string | null> {
    for (const s of this.nodeSources) {
      const r = await s.resolveNode(className);
      if (r) return r;
    }
    return null;
  }

  /** Resolve everything a workflow needs into a manifest. */
  async makeManifest(req: Requirements, workflow = "workflow.json"): Promise<Manifest> {
    const manifest: Manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      workflow,
      selfHostable: req.selfHostable,
      apiNodes: req.apiNodes,
      models: [],
      unresolvedModels: [],
      customNodes: [],
      unresolvedNodes: [],
      droppableMissing: [],
      totalBytes: 0,
    };
    if (!req.selfHostable) return manifest;

    const seenRepos = new Set<string>();
    for (const cls of req.customNodes) {
      const repo = await this.resolveNode(cls);
      if (repo) {
        if (CORE_REPO.test(repo)) continue; // native node: already part of the running install
        const pack = repo.replace(/\/+$/, "").split("/").pop() ?? repo;
        if (this.installed.has(pack) || seenRepos.has(repo)) continue;
        seenRepos.add(repo);
        manifest.customNodes.push({ class: cls, repo, pack } satisfies NodeRepo);
      } else if (DROPPABLE.has(cls)) {
        manifest.droppableMissing.push(cls);
      } else {
        manifest.unresolvedNodes.push(cls);
      }
    }
    for (const ref of req.models) {
      const r = await this.resolveModel(ref);
      if (r) {
        manifest.models.push({ ...ref, ...r });
        manifest.totalBytes += r.sizeBytes ?? 0;
      } else {
        const candidates = this.candidateLimit > 0 ? await this.candidates(ref, this.candidateLimit) : [];
        manifest.unresolvedModels.push({ ...ref, candidates });
      }
    }
    return manifest;
  }
}

export function createResolver(opts: ResolverOptions = {}): Resolver {
  return new Resolver(opts);
}
