import type {
  EvidenceSummary,
  GoalRun,
  PatchSummary,
  RepairStage,
} from "./types";

export interface RepairStatusEvent {
  run: GoalRun;
  stage: RepairStage;
  timestamp: string;
  detail: string;
}

export interface FailureDetectedEvent {
  runId: string;
  evidence: EvidenceSummary;
  targetSelector: string;
}

export interface PatchAppliedEvent {
  runId: string;
  patch: PatchSummary;
  timestamp: string;
}
