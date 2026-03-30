export type RepairStage =
  | "observing"
  | "analyzing"
  | "tracing_issue"
  | "proposing_patch"
  | "awaiting_approval"
  | "applying_fix"
  | "rebuilding"
  | "retesting"
  | "running_regressions"
  | "verified"
  | "needs_review";

export type BrowserActionKind =
  | "goto"
  | "fill"
  | "hover"
  | "click"
  | "wait_for_text"
  | "wait_for_url";

export interface BrowserAction {
  kind: BrowserActionKind;
  target: string;
  value?: string;
}

export interface RegressionCheck {
  path: string;
  expectText?: string;
}

export interface VisualPlaybackConfig {
  headless: boolean;
  showCursor: boolean;
  moveDurationMs: number;
  actionDelayMs: number;
}

export interface RunConfig {
  goal: string;
  projectRoot: string;
  appUrl: string;
  requireApproval: boolean;
  model: string;
  visualPlayback: VisualPlaybackConfig;
  browserActions: BrowserAction[];
  regressionChecks: RegressionCheck[];
}

export interface GoalRun {
  id: string;
  goal: string;
  stage: RepairStage;
  targetSelector?: string;
  summary?: string;
  expectedOutcome?: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface EvidenceSummary {
  consoleErrors: string[];
  networkFailures: string[];
  domNotes: string[];
}

export interface PatchSummary {
  filePath: string;
  reason: string;
  diffSummary: string;
}

export interface ProposedFilePatch {
  filePath: string;
  before: string;
  after: string;
  reason: string;
  diff: string;
}

export interface PendingPatch {
  id: string;
  rationale: string;
  targetFiles: string[];
  confidence: number;
  edits: ProposedFilePatch[];
}

export interface ScreenshotSummary {
  beforePath: string;
  afterPath: string;
}

export interface RegressionResult {
  path: string;
  passed: boolean;
  detail: string;
}

export interface AgentLogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RepairStateSnapshot {
  run: GoalRun;
  config: RunConfig;
  stage: RepairStage;
  timestamp: string;
  detail: string;
  evidence: EvidenceSummary;
  patch: PatchSummary;
  screenshots: ScreenshotSummary;
  pendingPatch: PendingPatch | null;
  regressions: RegressionResult[];
}

export interface FrameworkInfo {
  name: string;
  metaFramework: string | null;
  version: string | null;
  confidence: number;
  evidence: string[];
}

export interface ElementDescriptor {
  tagName: string;
  id: string | null;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  componentName: string | null;
  parentComponentNames: string[];
  cssSelector: string;
}

export interface EditModeRequest {
  element: ElementDescriptor;
  mode: "auto" | "custom";
  customPrompt: string | null;
  currentUrl: string;
  projectRoot: string;
}

export interface EditModeProposal {
  id: string;
  element: ElementDescriptor;
  patches: ProposedFilePatch[];
  rationale: string;
  confidence: number;
}

export interface EditModeProgress {
  proposalId: string;
  stage: "resolving" | "analyzing" | "generating" | "applying";
  detail: string;
  filePath?: string;
  lineNumber?: number;
}
