import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "@reform/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

export const defaultRunConfig: RunConfig = {
  autoRetestLocal: true,
  maxRetries: 3,
  goal: "Verify the primary user flow in the target app",
  projectRoot: path.resolve(process.env.REFORM_PROJECT_ROOT ?? rootDir),
  appUrl: process.env.REFORM_APP_URL ?? "http://127.0.0.1:3000",
  requireApproval: true,
  llmProvider: (process.env.REFORM_LLM_PROVIDER ?? "openrouter") as RunConfig["llmProvider"],
  llmFallbackProvider: "zai",
  model: process.env.REFORM_LLM_MODEL ?? process.env.REFORM_OPENROUTER_MODEL ?? "x-ai/grok-4.20-beta",
  visualPlayback: {
    headless: true,
    showCursor: false,
    moveDurationMs: 250,
    actionDelayMs: 80,
  },
  browserActions: [
    { kind: "goto", target: "/" },
    { kind: "click", target: "button" },
  ],
  regressionChecks: [
    { path: "/" },
  ],
};

export function normalizeRunConfig(input?: Partial<RunConfig>): RunConfig {
  const merged: RunConfig = {
    ...defaultRunConfig,
    ...input,
    visualPlayback: {
      ...defaultRunConfig.visualPlayback,
      ...input?.visualPlayback,
    },
    browserActions: input?.browserActions ?? defaultRunConfig.browserActions,
    regressionChecks: input?.regressionChecks ?? defaultRunConfig.regressionChecks,
  };

  return {
    ...merged,
    llmProvider: merged.llmProvider || defaultRunConfig.llmProvider,
    llmFallbackProvider:
      typeof merged.llmFallbackProvider === "undefined"
        ? defaultRunConfig.llmFallbackProvider
        : merged.llmFallbackProvider,
    projectRoot: path.resolve(merged.projectRoot),
  };
}
