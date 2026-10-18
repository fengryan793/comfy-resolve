import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const FIX = new URL("./fixtures/", import.meta.url).pathname;
export const WORKFLOWS = join(FIX, "workflows");
export const HTTP = join(FIX, "http");
export const GOLDEN = new URL("./golden/", import.meta.url).pathname;

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Fixture names that have a Python golden `<name>.requirements.json`. */
export async function goldenNames(): Promise<string[]> {
  const files = await readdir(GOLDEN);
  return files.filter((f) => f.endsWith(".requirements.json")).map((f) => f.replace(".requirements.json", "")).sort();
}
