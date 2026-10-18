import type { ModelRef } from "./types.js";

/** Widget strings ending in one of these are treated as downloadable model weights. */
export const MODEL_EXTS = [".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".sft"] as const;

/** Loader node type -> models/ sub-folder, used when no catalog told us the destination. */
export const DEST_BY_LOADER: Readonly<Record<string, string>> = {
  CheckpointLoaderSimple: "checkpoints",
  UNETLoader: "diffusion_models",
  UnetLoaderGGUF: "unet",
  VAELoader: "vae",
  CLIPLoader: "text_encoders",
  DualCLIPLoader: "text_encoders",
  LoraLoaderModelOnly: "loras",
  LoraLoader: "loras",
  ControlNetLoader: "controlnet",
  CLIPVisionLoader: "clip_vision",
  StyleModelLoader: "style_models",
  UpscaleModelLoader: "upscale_models",
};

export function isModelFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return MODEL_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Bare filename of a model reference. Windows-packaged workflows use "\" as the folder
 * separator ("Wan-Lighting\\Wan2.1 - lightx2v.safetensors"); on POSIX that is a literal
 * character, so every lookup would miss unless we normalise it first.
 */
export function normBase(ref: string): string {
  const unix = String(ref).replace(/\\/g, "/");
  return unix.slice(unix.lastIndexOf("/") + 1);
}

/** Folder prefix of a model reference (forward slashes), "" for a bare filename. */
export function normSubdir(ref: string): string {
  const unix = String(ref).replace(/\\/g, "/");
  const i = unix.lastIndexOf("/");
  return i === -1 ? "" : unix.slice(0, i);
}

/** Filename without its model extension. */
export function stem(basename: string): string {
  return basename.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|onnx|sft)$/i, "");
}

export function makeModelRef(ref: string, loader: string): ModelRef {
  return {
    ref,
    basename: normBase(ref),
    subdir: normSubdir(ref),
    loader,
    destGuess: DEST_BY_LOADER[loader] ?? "models",
  };
}
