import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type ConsoleMessage, type Locator, type Page } from "playwright";
import type {
  AgentLogEntry,
  BrowserAction,
  EvidenceSummary,
  GoalRun,
  FlowReplaySnapshot,
  PatchSummary,
  PendingPatch,
  RegressionCheck,
  RegressionResult,
  RepairStage,
  RepairStateSnapshot,
  RunConfig,
  ScreenshotSummary,
} from "@reform/shared";
import { normalizeRunConfig } from "./config";
import { proposePatchWithLlm } from "./llm";
import {
  applyProposedEdits,
  collectCandidateFiles,
  ensureProjectRoot,
  previewProposedEdits,
} from "./project";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const runtimeDir = path.join(rootDir, "agent/runtime");
const dashboardStateFile = path.join(rootDir, "dashboard/public/repair-state.json");
const sandboxStateFile = path.join(rootDir, "sandbox-app/public/repair-state.json");
const dashboardRuntimeDir = path.join(rootDir, "dashboard/public/runtime");

const emptyEvidence: EvidenceSummary = {
  consoleErrors: [],
  networkFailures: [],
  domNotes: [],
};

const emptyPatch: PatchSummary = {
  filePath: "",
  reason: "",
  diffSummary: "",
};

const emptyScreenshots: ScreenshotSummary = {
  beforePath: "",
  afterPath: "",
};

interface RepairLoopHooks {
  onState?: (snapshot: RepairStateSnapshot) => Promise<void> | void;
  onLog?: (entry: AgentLogEntry) => void;
  requestApproval?: (pendingPatch: PendingPatch) => Promise<boolean>;
}

interface LocalEscalationInput extends Partial<RunConfig> {
  localEvidence?: EvidenceSummary;
  localFailureReason?: string;
  localCurrentUrl?: string;
}

interface FlowCaptureResult {
  evidence: EvidenceSummary;
  primaryFlowPassed: boolean;
  failureDetail?: string;
  flow: FlowReplaySnapshot;
}

function createLog(level: AgentLogEntry["level"], message: string): AgentLogEntry {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
  };
}

function createRun(config: RunConfig): GoalRun {
  return {
    id: `run_${Date.now()}`,
    goal: config.goal,
    expectedOutcome: "Primary flow succeeds and regression checks stay healthy.",
    stage: "observing",
    summary: "Waiting for the browser run to begin.",
    retryCount: 0,
    maxRetries: 3,
  };
}

function createInitialSnapshot(config: RunConfig): RepairStateSnapshot {
  return {
    run: createRun(config),
    config,
    stage: "observing",
    timestamp: "",
    detail: "Waiting for the agent to start the flow.",
    primaryFlow: null,
    evidence: emptyEvidence,
    patch: emptyPatch,
    screenshots: emptyScreenshots,
    pendingPatch: null,
    regressions: [],
  };
}

async function persistSnapshot(snapshot: RepairStateSnapshot) {
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(dashboardRuntimeDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(runtimeDir, "repair-state.json"), payload, "utf8"),
    writeFile(dashboardStateFile, payload, "utf8"),
    writeFile(sandboxStateFile, payload, "utf8"),
  ]);
}

async function emitStage(
  config: RunConfig,
  run: GoalRun,
  stage: RepairStage,
  detail: string,
  hooks: RepairLoopHooks,
  options?: {
    evidence?: EvidenceSummary;
    patch?: PatchSummary;
    screenshots?: ScreenshotSummary;
    pendingPatch?: PendingPatch | null;
    regressions?: RegressionResult[];
    primaryFlow?: FlowReplaySnapshot | null;
  },
) {
  const snapshot: RepairStateSnapshot = {
    run: { ...run, stage },
    config,
    stage,
    timestamp: new Date().toISOString(),
    detail,
    primaryFlow: options?.primaryFlow ?? null,
    evidence: options?.evidence ?? emptyEvidence,
    patch: options?.patch ?? emptyPatch,
    screenshots: options?.screenshots ?? emptyScreenshots,
    pendingPatch: options?.pendingPatch ?? null,
    regressions: options?.regressions ?? [],
  };

  await persistSnapshot(snapshot);
  hooks.onLog?.(createLog("info", `${stage}: ${detail}`));
  await hooks.onState?.(snapshot);
  return snapshot;
}

function resolveLocator(page: Page, target: string) {
  if (target.startsWith("label:")) {
    return page.getByLabel(target.slice(6));
  }

  if (target.startsWith("role:")) {
    const parts = target.split(":");
    const role = parts[1];
    const name = parts.slice(2).join(":");
    return page.getByRole(role as Parameters<Page["getByRole"]>[0], {
      name,
      exact: true,
    });
  }

  if (target.startsWith("text:")) {
    return page.getByText(target.slice(5));
  }

  return page.locator(target);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFlowSnapshot(
  config: RunConfig,
  options: {
    currentActionIndex: number | null;
    failingActionIndex: number | null;
    failingAction: BrowserAction | null;
    finalUrl: string;
    failureReason: string | null;
    capturedAt?: string;
  },
): FlowReplaySnapshot {
  const startAction = config.browserActions.find((action) => action.kind === "goto") || config.browserActions[0] || null;
  const startUrl = startAction?.kind === "goto"
    ? new URL(startAction.target, config.appUrl).toString()
    : config.appUrl;

  return {
    id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: config.goal,
    startUrl,
    browserActions: config.browserActions.map((action) => ({ ...action })),
    regressionChecks: config.regressionChecks.map((check) => ({ ...check })),
    capturedAt: options.capturedAt || new Date().toISOString(),
    currentActionIndex: options.currentActionIndex,
    failingActionIndex: options.failingActionIndex,
    failingAction: options.failingAction ? { ...options.failingAction } : null,
    finalUrl: options.finalUrl,
    failureReason: options.failureReason,
  };
}

async function ensurePlaybackCursor(page: Page) {
  await page
    .evaluate(() => {
      const cursorId = "__reform_playback_cursor__";
      const styleId = "__reform_playback_cursor_style__";

      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          #${cursorId} {
            position: fixed;
            left: 0;
            top: 0;
            width: 18px;
            height: 18px;
            border-radius: 999px;
            border: 2px solid rgba(255, 255, 255, 0.92);
            background: rgba(98, 175, 255, 0.35);
            box-shadow:
              0 0 0 8px rgba(98, 175, 255, 0.14),
              0 10px 30px rgba(0, 0, 0, 0.24);
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 2147483647;
            transition:
              left 80ms linear,
              top 80ms linear,
              transform 90ms ease,
              box-shadow 120ms ease,
              opacity 120ms ease;
            opacity: 0;
          }
          #${cursorId}[data-visible="true"] {
            opacity: 1;
          }
          #${cursorId}[data-clicking="true"] {
            transform: translate(-50%, -50%) scale(0.88);
            box-shadow:
              0 0 0 12px rgba(255, 193, 107, 0.22),
              0 12px 32px rgba(0, 0, 0, 0.28);
          }
        `;
        document.head.appendChild(style);
      }

      if (!document.getElementById(cursorId)) {
        const cursor = document.createElement("div");
        cursor.id = cursorId;
        cursor.setAttribute("data-visible", "false");
        document.documentElement.appendChild(cursor);
      }
    })
    .catch(() => {});
}

async function setPlaybackCursorPosition(page: Page, point: { x: number; y: number }, clicking = false) {
  await page
    .evaluate(
      ({ x, y, clicking: isClicking }) => {
        const cursor = document.getElementById("__reform_playback_cursor__");
        if (!cursor) return;
        cursor.setAttribute("data-visible", "true");
        cursor.setAttribute("data-clicking", isClicking ? "true" : "false");
        cursor.setAttribute("style", `left:${x}px;top:${y}px;`);
      },
      { x: point.x, y: point.y, clicking },
    )
    .catch(() => {});
}

async function moveMouseToLocator(page: Page, locator: Locator, config: RunConfig) {
  await ensurePlaybackCursor(page);
  await locator.waitFor({ state: "visible", timeout: 3000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  const box = await locator.boundingBox();
  if (!box) return null;

  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const steps = config.visualPlayback.showCursor
    ? Math.max(2, Math.round(config.visualPlayback.moveDurationMs / 16))
    : 1;

  await page.mouse.move(point.x, point.y, { steps });
  await setPlaybackCursorPosition(page, point);
  return point;
}

interface BrowserActionExecutionHooks {
  onActionStart?: (index: number, action: BrowserAction) => void;
  onActionComplete?: (index: number, action: BrowserAction) => void;
}

async function runBrowserActions(
  page: Page,
  appUrl: string,
  actions: BrowserAction[],
  config: RunConfig,
  hooks: BrowserActionExecutionHooks = {},
) {
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    hooks.onActionStart?.(index, action);

    if (action.kind === "goto") {
      await page.goto(new URL(action.target, appUrl).toString(), { waitUntil: "networkidle" });
      if (config.visualPlayback.showCursor) {
        await ensurePlaybackCursor(page);
      }
      hooks.onActionComplete?.(index, action);
      continue;
    }

    if (action.kind === "fill") {
      await resolveLocator(page, action.target).fill(action.value ?? "");
      continue;
    }

    if (action.kind === "click") {
      const locator = resolveLocator(page, action.target);
      const shouldAnimatePointer = config.visualPlayback.showCursor;

      if (shouldAnimatePointer) {
        const point = await moveMouseToLocator(page, locator, config);
        if (point) {
          await sleep(config.visualPlayback.actionDelayMs);
          await setPlaybackCursorPosition(page, point, true);
          await page.mouse.click(point.x, point.y, { delay: config.visualPlayback.actionDelayMs });
          await setPlaybackCursorPosition(page, point, false);
          hooks.onActionComplete?.(index, action);
          continue;
        }
      }

      await locator.click();
      hooks.onActionComplete?.(index, action);
      continue;
    }

    if (action.kind === "hover") {
      const locator = resolveLocator(page, action.target);

      if (config.visualPlayback.showCursor) {
        const point = await moveMouseToLocator(page, locator, config);
        if (point) {
          await sleep(config.visualPlayback.actionDelayMs);
          hooks.onActionComplete?.(index, action);
          continue;
        }
      }

      await locator.hover();
      hooks.onActionComplete?.(index, action);
      continue;
    }

    if (action.kind === "wait_for_text") {
      await resolveLocator(page, action.target).waitFor({ state: "visible", timeout: 3000 });
      hooks.onActionComplete?.(index, action);
      continue;
    }

    if (action.kind === "wait_for_url") {
      await page.waitForURL(new RegExp(action.target), { timeout: 3000 });
      hooks.onActionComplete?.(index, action);
    }
  }
}

async function captureEvidence(page: Page, config: RunConfig): Promise<FlowCaptureResult> {
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  let currentActionIndex: number | null = null;
  let currentAction: BrowserAction | null = null;

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()}`);
  });

  let primaryFlowPassed = true;
  let failureDetail: string | undefined;

  try {
    await runBrowserActions(page, config.appUrl, config.browserActions, config, {
      onActionStart: (index, action) => {
        currentActionIndex = index;
        currentAction = action;
      },
      onActionComplete: (index) => {
        currentActionIndex = index;
      },
    });
  } catch (error) {
    primaryFlowPassed = false;
    failureDetail = error instanceof Error ? error.message : "Primary flow failed.";
  }

  const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";

  return {
    primaryFlowPassed,
    failureDetail,
    flow: createFlowSnapshot(config, {
      currentActionIndex,
      failingActionIndex: primaryFlowPassed ? null : currentActionIndex,
      failingAction: primaryFlowPassed ? null : currentAction,
      finalUrl: page.url(),
      failureReason: failureDetail ?? null,
    }),
    evidence: {
      consoleErrors,
      networkFailures: requestFailures,
      domNotes: [
        `Current URL: ${page.url()}`,
        `Body excerpt: ${bodyText.slice(0, 240)}`,
        primaryFlowPassed
          ? "Primary flow completed without Playwright action failures."
          : `Primary flow failure: ${failureDetail}`,
      ],
    } satisfies EvidenceSummary,
  };
}

async function captureScreenshot(page: Page, filename: string) {
  await mkdir(dashboardRuntimeDir, { recursive: true });
  const destination = path.join(dashboardRuntimeDir, filename);
  await page.screenshot({ path: destination, fullPage: true });
  return `/runtime/${filename}`;
}

async function runRegressionChecks(
  page: Page,
  config: RunConfig,
  checks: RegressionCheck[],
): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];

  for (const check of checks) {
    try {
      await page.goto(new URL(check.path, config.appUrl).toString(), { waitUntil: "networkidle" });
      const bodyText = ((await page.locator("body").textContent().catch(() => "")) ?? "").trim();
      const expectText = check.expectText ? await page.getByText(check.expectText).isVisible() : bodyText.length > 20;
      results.push({
        path: check.path,
        passed: Boolean(expectText),
        detail: expectText
          ? `Expectation satisfied for ${check.path}`
          : `Expectation failed for ${check.path}`,
      });
    } catch (error) {
      results.push({
        path: check.path,
        passed: false,
        detail: error instanceof Error ? error.message : "Regression check failed.",
      });
    }
  }

  return results;
}

async function driveRepairFromEvidence(
  config: RunConfig,
  run: GoalRun,
  evidence: EvidenceSummary,
  currentUrl: string,
  hooks: RepairLoopHooks,
  screenshots: ScreenshotSummary,
  primaryFlow?: FlowReplaySnapshot | null,
) {
  await emitStage(
    config,
    run,
    "analyzing",
    "Collected browser evidence and starting project inspection.",
    hooks,
    {
      evidence,
      screenshots,
      primaryFlow: primaryFlow ?? null,
    },
  );

  const candidateFiles = await collectCandidateFiles(config, evidence);
  hooks.onLog?.(createLog("info", `Scanned ${candidateFiles.length} candidate files for LLM targeting.`));

  await emitStage(
    config,
    run,
    "tracing_issue",
    "Sending failure evidence and candidate files to the LLM for dynamic targeting.",
    hooks,
    {
      evidence,
      screenshots,
      primaryFlow: primaryFlow ?? null,
    },
  );

  const proposal = await proposePatchWithLlm({
    config,
    evidence,
    candidateFiles,
    currentUrl,
  });

  const appliedEditsPreview = await previewProposedEdits(config, proposal.patches);

  const pendingPatch: PendingPatch = {
    id: `patch_${Date.now()}`,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    targetFiles: proposal.targetFiles,
    edits: appliedEditsPreview,
  };

  const patchSummary: PatchSummary = {
    filePath: proposal.targetFiles[0] ?? "",
    reason: proposal.rationale,
    diffSummary: proposal.patches.map((patch) => patch.reason).join(" | "),
  };

  await emitStage(
    config,
    run,
    "proposing_patch",
    "LLM patch proposal generated. Waiting for approval policy.",
    hooks,
    {
      evidence,
      patch: patchSummary,
      screenshots,
      pendingPatch,
      primaryFlow: primaryFlow ?? null,
    },
  );

  let approved = !config.requireApproval;

  if (config.requireApproval) {
    await emitStage(
      config,
      run,
      "awaiting_approval",
      "Patch proposal is waiting for explicit approval in the dashboard.",
      hooks,
      {
        evidence,
        patch: patchSummary,
        screenshots,
        pendingPatch,
        primaryFlow: primaryFlow ?? null,
      },
    );

    approved = (await hooks.requestApproval?.(pendingPatch)) ?? false;
  }

  if (!approved) {
    await emitStage(
      config,
      run,
      "needs_review",
      "Patch proposal was rejected or no approval was received.",
      hooks,
      {
        evidence,
        patch: patchSummary,
        screenshots,
        pendingPatch,
        primaryFlow: primaryFlow ?? null,
      },
    );
    return { continued: false, patchSummary: null, regressionChecks: proposal.regressionChecks };
  }

  const appliedEdits = await applyProposedEdits(config, pendingPatch.edits);
  pendingPatch.edits = appliedEdits;

  await emitStage(
    config,
    run,
    "applying_fix",
    "Applying approved edits to the target project.",
    hooks,
      {
        evidence,
        patch: {
          ...patchSummary,
          diffSummary: appliedEdits.map((edit) => edit.reason).join(" | "),
        },
        screenshots,
        pendingPatch,
        primaryFlow: primaryFlow ?? null,
      },
    );
  return {
    continued: true,
    patchSummary,
    regressionChecks: proposal.regressionChecks,
  };
}

export async function initializeRepairState(input?: Partial<RunConfig>, hooks: RepairLoopHooks = {}) {
  const config = normalizeRunConfig(input);
  const snapshot = createInitialSnapshot(config);
  await persistSnapshot(snapshot);
  hooks.onLog?.(createLog("info", "observing: Waiting for the agent to start the flow."));
  await hooks.onState?.(snapshot);
}

export async function runRepairFromLocalFailure(input?: LocalEscalationInput, hooks: RepairLoopHooks = {}) {
  const config = normalizeRunConfig(input);
  await ensureProjectRoot(config.projectRoot);
  const run = createRun(config);
  const detail = input?.localFailureReason || "Received a same-tab failure report from the overlay.";
  const evidence = input?.localEvidence ?? {
    consoleErrors: [],
    networkFailures: [],
    domNotes: [detail],
  };
  const primaryFlow = createFlowSnapshot(config, {
    currentActionIndex: 0,
    failingActionIndex: null,
    failingAction: null,
    finalUrl: input?.localCurrentUrl ?? config.appUrl,
    failureReason: detail,
  });

  await emitStage(
    config,
    run,
    "observing",
    "Received same-tab failure evidence from the overlay. Skipping browser replay and starting diagnosis.",
    hooks,
    {
      evidence,
      primaryFlow,
    },
  );

  run.retryCount = 1;
  let localResult;
  try {
    localResult = await driveRepairFromEvidence(
      config,
      run,
      {
        ...evidence,
        domNotes: [
          ...evidence.domNotes,
          `Overlay failure reason: ${detail}`,
        ],
      },
      input?.localCurrentUrl ?? config.appUrl,
      hooks,
      { beforePath: "", afterPath: "" },
      primaryFlow,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent failure.";
    hooks.onLog?.(createLog("error", `local_failure_repair_aborted: ${message}`));
    await emitStage(
      config,
      run,
      "needs_review",
      "The same-tab diagnosis could not finish automatically and needs review.",
      hooks,
      {
        evidence: {
          ...evidence,
          consoleErrors: [...evidence.consoleErrors, message],
          domNotes: [...evidence.domNotes, `Overlay failure reason: ${detail}`],
        },
        primaryFlow,
      },
    );
    return;
  }

  if (!localResult.continued || !localResult.patchSummary) {
    return;
  }

  await emitStage(
    config,
    run,
    "needs_review",
    "Patch applied from captured same-tab failure evidence. Rerun the flow in the browser to verify the fix.",
    hooks,
    {
      evidence: {
        ...evidence,
        domNotes: [...evidence.domNotes, `Overlay failure reason: ${detail}`],
      },
      patch: localResult.patchSummary,
      screenshots: { beforePath: "", afterPath: "" },
      primaryFlow,
    },
  );
}

export async function runRepairLoop(input?: Partial<RunConfig>, hooks: RepairLoopHooks = {}) {
  const config = normalizeRunConfig(input);
  await ensureProjectRoot(config.projectRoot);
  const run = createRun(config);
  const keepVisualBrowserOpen = config.visualPlayback.showCursor && !config.visualPlayback.headless;
  let primaryFlow: FlowReplaySnapshot | null = null;

  await emitStage(config, run, "observing", "Opening the app and executing the configured browser flow.", hooks);

  const browser = await chromium.launch({
    headless: config.visualPlayback.showCursor ? false : config.visualPlayback.headless,
  });

  try {
    const page = await browser.newPage();
    const flowCapture = await captureEvidence(page, config);
    let evidence = flowCapture.evidence;
    primaryFlow = flowCapture.flow;
    const beforePath = await captureScreenshot(page, "before-repair.png");
    run.retryCount = 1;

    await emitStage(
      config,
      run,
      "analyzing",
      "Collected browser evidence and starting project inspection.",
      hooks,
      {
        evidence,
        screenshots: { beforePath, afterPath: "" },
        primaryFlow,
      },
    );

    if (flowCapture.primaryFlowPassed) {
      hooks.onLog?.(
        createLog("info", "primary_flow_passed: Primary flow succeeded before repair. Skipping LLM targeting."),
      );

      await emitStage(
        config,
        run,
        "running_regressions",
        "Primary flow already passed. Running semantic regression checks without invoking repair.",
        hooks,
        {
          evidence,
          screenshots: { beforePath, afterPath: beforePath },
          primaryFlow,
        },
      );

      const regressions = await runRegressionChecks(page, config, config.regressionChecks);
      const allPassed = regressions.every((entry) => entry.passed);

      await emitStage(
        config,
        run,
        allPassed ? "verified" : "needs_review",
        allPassed
          ? "Primary flow already passed and regression checks stayed healthy."
          : "Primary flow already passed, but one or more regression checks failed.",
        hooks,
        {
          evidence,
          screenshots: { beforePath, afterPath: beforePath },
          regressions,
          primaryFlow,
        },
      );
      return;
    }
    let currentBeforePath = beforePath;
    let lastPatchSummary: PatchSummary | null = null;

    while (run.retryCount <= (run.maxRetries ?? 3)) {
      const repairResult = await driveRepairFromEvidence(
        config,
        run,
        evidence,
        page.url(),
        hooks,
        { beforePath: currentBeforePath, afterPath: "" },
        primaryFlow,
      );

      if (!repairResult.continued || !repairResult.patchSummary) {
        return;
      }

      lastPatchSummary = repairResult.patchSummary;

      await emitStage(
        config,
        run,
        "rebuilding",
        "Waiting for the local app to reload the updated code.",
        hooks,
        {
          evidence,
          patch: repairResult.patchSummary,
          screenshots: { beforePath: currentBeforePath, afterPath: "" },
          primaryFlow,
        },
      );

      await page.reload({ waitUntil: "networkidle" });

      await emitStage(
        config,
        run,
        "retesting",
        "Replaying the primary flow after the approved patch.",
        hooks,
        {
          evidence,
          patch: repairResult.patchSummary,
          screenshots: { beforePath: currentBeforePath, afterPath: "" },
          primaryFlow,
        },
      );

      const replayCapture = await captureEvidence(page, config);
      evidence = replayCapture.evidence;
      primaryFlow = replayCapture.flow;
      const afterPath = await captureScreenshot(page, "after-repair.png");

      if (replayCapture.primaryFlowPassed) {
        await emitStage(
          config,
          run,
          "running_regressions",
          "Running semantic regression checks on nearby flows.",
          hooks,
          {
            evidence,
            patch: repairResult.patchSummary,
            screenshots: { beforePath: currentBeforePath, afterPath },
            primaryFlow,
          },
        );

        const regressionChecks =
          repairResult.regressionChecks.length > 0 ? repairResult.regressionChecks : config.regressionChecks;
        const regressions = await runRegressionChecks(page, config, regressionChecks);
        const allPassed = regressions.every((entry) => entry.passed);

        await emitStage(
          config,
          run,
          allPassed ? "verified" : "needs_review",
          allPassed
            ? "Primary flow passed and semantic regression checks stayed healthy."
            : "Primary flow passed, but one or more regression checks failed.",
          hooks,
          {
            evidence,
            patch: repairResult.patchSummary,
            screenshots: { beforePath: currentBeforePath, afterPath },
            regressions,
            primaryFlow,
          },
        );
        return;
      }

      if ((run.retryCount ?? 1) >= (run.maxRetries ?? 3)) {
        await emitStage(
          config,
          run,
          "needs_review",
          "Reform applied patches and replayed the flow, but the expected result still did not occur within the retry limit.",
          hooks,
          {
            evidence,
            patch: repairResult.patchSummary,
            screenshots: { beforePath: currentBeforePath, afterPath },
            primaryFlow,
          },
        );
        return;
      }

      run.retryCount = (run.retryCount ?? 1) + 1;
      currentBeforePath = afterPath;
      await emitStage(
        config,
        run,
        "analyzing",
        "The replay still failed after the latest patch. Continuing with another repair cycle using the updated evidence.",
        hooks,
        {
          evidence,
          patch: lastPatchSummary,
          screenshots: { beforePath: currentBeforePath, afterPath: "" },
          primaryFlow,
        },
      );
    }
  } catch (error) {
    hooks.onLog?.(createLog("error", error instanceof Error ? error.message : "Unknown agent failure."));
    await emitStage(config, run, "needs_review", "The repair loop hit a blocker and needs review.", hooks, {
      evidence: {
        consoleErrors: [String(error)],
        networkFailures: [],
        domNotes: [],
      },
      primaryFlow,
    });
    throw error;
  } finally {
    if (!keepVisualBrowserOpen) {
      await browser.close();
    } else {
      hooks.onLog?.(
        createLog(
          "info",
          "visual_browser_left_open: Leaving the visible browser session open for inspection. Close it manually when done.",
        ),
      );
    }
  }
}
