import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunConfig } from "@reform/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

export const defaultRunConfig: RunConfig = {
  goal: "Sign up and reach dashboard",
  projectRoot: path.join(rootDir, "sandbox-app"),
  appUrl: process.env.REFORM_APP_URL ?? "http://127.0.0.1:4173",
  requireApproval: true,
  model: process.env.REFORM_LLM_MODEL ?? process.env.REFORM_OPENAI_MODEL ?? "glm-5-turbo",
  visualPlayback: {
    headless: true,
    showCursor: false,
    moveDurationMs: 250,
    actionDelayMs: 80,
  },
  browserActions: [
    { kind: "goto", target: "/" },
    { kind: "fill", target: "label:Full name", value: "Jamie Torres" },
    { kind: "fill", target: "label:School email", value: "jamie@school.edu" },
    { kind: "click", target: "role:button:Sign Up" },
    { kind: "wait_for_text", target: "text:Missing required field `name`." },
  ],
  regressionChecks: [
    { path: "/", expectText: "Create account" },
    { path: "/dashboard", expectText: "Welcome to the dashboard" },
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
    projectRoot: path.resolve(merged.projectRoot),
  };
}
