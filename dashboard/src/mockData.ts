import type { RepairStage } from "@reform/shared";

export const stageOrder: RepairStage[] = [
  "observing",
  "analyzing",
  "tracing_issue",
  "proposing_patch",
  "awaiting_approval",
  "applying_fix",
  "rebuilding",
  "retesting",
  "running_regressions",
  "verified",
  "needs_review",
];
