import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "@reform/shared";
import { normalizeRunConfig } from "./config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const runtimeConfigPath = path.join(rootDir, "agent/runtime/launch-config.json");

export async function loadRuntimeConfig() {
  if (process.env.REFORM_IGNORE_RUNTIME_CONFIG === "1") {
    return null;
  }

  try {
    const raw = await readFile(runtimeConfigPath, "utf8");
    return normalizeRunConfig(JSON.parse(raw) as Partial<RunConfig>);
  } catch {
    return null;
  }
}

export function getRuntimeConfigPath() {
  return runtimeConfigPath;
}
