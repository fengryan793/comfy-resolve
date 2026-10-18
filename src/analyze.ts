import { isModelFile, makeModelRef } from "./refs.js";
import type { Graph, ModelRef, Requirements } from "./types.js";

/**
 * Node classes shipped with core ComfyUI (prefix match) - not exhaustive, used to skip
 * resolution. Prefix matching means "KSampler" also covers "KSamplerAdvanced".
 * Pass `/object_info` to `analyze()` to make the check exact instead.
 */
export const CORE_PREFIXES: readonly string[] = [
  "CLIPTextEncode", "KSampler", "CheckpointLoader", "UNETLoader", "VAELoader", "VAEDecode",
  "VAEEncode", "LoadImage", "SaveImage", "EmptyLatent", "CLIPLoader", "LoraLoader",
  "PreviewImage", "PrimitiveNode", "Primitive", "Note", "MarkdownNote", "Reroute",
  "ImageScale", "DualCLIPLoader", "ModelSampling", "SamplerCustom", "KSamplerSelect",
  "BasicScheduler", "BasicGuider", "ConditioningZeroOut", "ConditioningCombine",
  "FluxGuidance", "SaveVideo", "CreateVideo", "LoadVideo", "GetImageSize",
  "ImagePadForOutpaint", "InpaintModelConditioning", "SolidMask", "EmptySD3", "EmptyHunyuan",
  "CLIPVision", "ControlNet", "UpscaleModel", "ImageUpscaleWithModel", "LatentUpscale",
  "ComfyMath", "ComfySwitch", "TextEncodeQwenImage", "StyleModel", "RandomNoise",
  "DifferentialDiffusion", "ImageBatch", "ImageInvert", "ImageCrop", "MaskToImage",
  "ImageToMask", "GrowMask", "FeatherMask", "InvertMask", "SetLatentNoiseMask",
  "EmptyImage", "ImageBlend", "ImageComposite", "JoinImage", "SplitImage", "SaveAnimated",
  "unCLIP", "Tuple", "Int", "Float", "String", "Boolean", "webcam", "EmptyLTXV",
  "LTXV", "ModelMergeLTXV", "ReferenceLatent", "EmptyFlux2", "Flux2Scheduler", "CFGGuider",
  "CFGNorm", "GetVideoComponents", "ImageFromBatch", "RepeatImageBatch", "ImageStitch",
  "ThresholdMask", "PorterDuffImageComposite", "SplitSigmas", "FlipSigmas", "PatchModel",
  "TorchCompileModel", "FreSca", "PerpNeg", "Align", "Latent", "Mask", "Sampler",
  "Scheduler", "Guider", "Noise", "Cond", "Model", "WanImageToVideo", "WanFunControlToVideo",
  "WanVaceToVideo", "TrimVideoLatent", "WanCameraImageToVideo", "WanPhantomSubjectToVideo",
];

/**
 * Node types that call hosted cloud-API providers. A workflow containing any of them cannot
 * be fully self-hosted. "Minimax(?!H3)" keeps the local, self-hostable MiniMax-H3 nodes out.
 */
export const API_PATTERNS =
  /^RH_|Seedance|Minimax(?!H3)|Kling|Vidu|Hailuo|Runway|Veo\b|Sora|Pika|Doubao|Jimeng|Gemini|BizyAir|Nano[Bb]anana|Volc|OpenAI|GPTImage|Ideogram|Recraft|Luma\b/i;

/** Display/sink nodes that are safe to drop when their pack cannot be found. */
export const DROPPABLE: ReadonlySet<string> = new Set([
  "TextPreview", "LayerUtility: PurgeVRAM", "ShowText|pysssss", "PreviewAny",
  "Image Comparer (rgthree)", "PlaySound|pysssss", "easy cleanGpuUsed", "Label (rgthree)",
  "Fast Groups Bypasser (rgthree)", "Fast Groups Muter (rgthree)", "PreviewImage",
]);

/** Frontend-only virtual nodes that are never sent to the backend. */
export const VIRTUAL: ReadonlySet<string> = new Set([
  "Note", "MarkdownNote", "Reroute", "GetNode", "SetNode", "PrimitiveNode",
]);

export interface AnalyzeOptions {
  /**
   * ComfyUI's /object_info (or just its keys). When given, a node type is "core" iff it is
   * present here, instead of relying on CORE_PREFIXES.
   */
  objectInfo?: Record<string, unknown> | Iterable<string>;
}

export function isApiNode(type: string): boolean {
  return API_PATTERNS.test(type);
}

export function isCoreNode(type: string, known?: ReadonlySet<string>): boolean {
  if (known) return known.has(type);
  return CORE_PREFIXES.some((p) => type.startsWith(p));
}

/** Boil a parsed workflow down to what must be installed and downloaded to run it. */
export function analyze(graph: Graph, opts: AnalyzeOptions = {}): Requirements {
  const known = opts.objectInfo
    ? new Set(Symbol.iterator in Object(opts.objectInfo) && typeof opts.objectInfo !== "string"
        ? (opts.objectInfo as Iterable<string>)
        : Object.keys(opts.objectInfo as Record<string, unknown>))
    : undefined;

  const types: string[] = [];
  const models: ModelRef[] = [];
  const seen = new Set<string>();
  let hasLoadImage = false;
  for (const n of graph.nodes) {
    const t = n.type;
    types.push(t);
    if (t === "LoadImage") hasLoadImage = true;
    for (const w of n.widgets) {
      if (isModelFile(w) && !seen.has(w)) {
        seen.add(w);
        models.push(makeModelRef(w, t));
      }
    }
  }
  const apiNodes = [...new Set(types.filter((t) => t && isApiNode(t)))].sort();
  const customNodes = [
    ...new Set(types.filter((t) => t && !VIRTUAL.has(t) && !isApiNode(t) && !isCoreNode(t, known))),
  ].sort();
  return {
    format: graph.format,
    nodeCount: graph.nodes.length,
    apiNodes,
    selfHostable: apiNodes.length === 0,
    customNodes,
    models,
    hasLoadImage,
  };
}
