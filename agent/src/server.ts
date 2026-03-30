import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
import type { AgentLogEntry, EditModeProposal, EditModeProgress, ElementDescriptor, PendingPatch, RepairStateSnapshot, RunConfig } from "@reform/shared";
import { defaultRunConfig, normalizeRunConfig } from "./config";
import { createUnifiedDiff } from "./diff";
import { createSession, populateBackups, storeBackup, setSessionProjectRoot, setProposal, getSessionState, applyPatches, rollback as rollbackSession, clearSession } from "./editModeSession";
import { resolveElementToFile } from "./elementResolver";
import { proposeElementEditWithLlm } from "./llm";
import { renderEditModeScript } from "./editModeScript";
import { renderOverlayScript } from "./overlayScript";
import { inferLikelyRoutesForTarget, scanProjectFramework } from "./project";
import { initializeRepairState, runRepairFromLocalFailure, runRepairLoop } from "./repairLoop";
import { loadRuntimeConfig } from "./runtimeConfig";

const port = Number(process.env.REFORM_AGENT_PORT ?? "8787");
const runtimeAssetsDir = path.resolve(new URL("../runtime", import.meta.url).pathname, "../../dashboard/public/runtime");

let activeRun: Promise<void> | null = null;
let latestSnapshot: RepairStateSnapshot | null = null;
let lastLogs: AgentLogEntry[] = [];
let pendingApproval:
  | {
      patch: PendingPatch;
      resolve: (approved: boolean) => void;
    }
  | null = null;
let cachedFramework: import("@reform/shared").FrameworkInfo | null = null;

function broadcast(payload: unknown) {
  const message = JSON.stringify(payload);
  for (const client of wsServer.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function rememberLog(entry: AgentLogEntry) {
  lastLogs = [...lastLogs.slice(-199), entry];
  console.log(`[reform.run][${entry.level}] ${entry.message}`);
  broadcast({ type: "log", payload: entry });
}

async function handleSnapshot(snapshot: RepairStateSnapshot) {
  latestSnapshot = snapshot;
  broadcast({ type: "state", payload: snapshot });
}

async function requestApproval(patch: PendingPatch) {
  broadcast({ type: "approval_requested", payload: patch });
  return await new Promise<boolean>((resolve) => {
    pendingApproval = { patch, resolve };
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null as T | null;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function broadcastEditProgress(progress: EditModeProgress) {
  broadcast({ type: "edit_progress", payload: progress });
}

async function processEditProposal(
  proposalId: string,
  body: {
    element: ElementDescriptor;
    mode?: "auto" | "custom";
    customPrompt?: string | null;
    currentUrl?: string;
    projectRoot: string;
  },
  config: RunConfig,
): Promise<void> {
  try {
    broadcastEditProgress({
      proposalId,
      stage: "resolving",
      detail: "Finding source file for selected element...",
    });

    const resolved = await resolveElementToFile(body.projectRoot, body.element, body.currentUrl);
    if (!resolved) {
      broadcast({
        type: "edit_error",
        payload: { proposalId, error: "Could not map the selected element to any source file." },
      });
      return;
    }

    broadcastEditProgress({
      proposalId,
      stage: "analyzing",
      detail: `Generating edit proposal for ${resolved.filePath}...`,
      filePath: resolved.filePath,
      lineNumber: resolved.lineNumber ?? undefined,
    });

    const result = await proposeElementEditWithLlm({
      config,
      element: body.element,
      fileContent: resolved.content,
      filePath: resolved.filePath,
      customPrompt: body.customPrompt || null,
      currentUrl: body.currentUrl || "",
      framework: cachedFramework,
    });

    broadcastEditProgress({
      proposalId,
      stage: "generating",
      detail: "Preparing changes for review...",
    });

    const proposal: EditModeProposal = {
      id: proposalId,
      element: body.element,
      patches: [],
      rationale: result.rationale,
      confidence: result.confidence,
    };

    // Read files and compute diffs — do NOT write to disk yet
    await populateBackups(proposalId);
    setSessionProjectRoot(proposalId, body.projectRoot);
    for (const patch of result.patches) {
      const absolutePath = path.isAbsolute(patch.filePath)
        ? patch.filePath
        : path.join(body.projectRoot, patch.filePath);
      const originalContent = await readFile(absolutePath, "utf8");

      if (!originalContent.includes(patch.before)) continue;

      // Store backup for potential rollback
      storeBackup(proposalId, absolutePath, originalContent);

      const patchedContent = originalContent.replace(patch.before, patch.after);
      proposal.patches.push({
        filePath: patch.filePath,
        before: patch.before,
        after: patch.after,
        reason: patch.reason,
        diff: createUnifiedDiff(patch.filePath, originalContent, patchedContent),
      });
    }

    setProposal(proposalId, proposal);

    broadcast({ type: "edit_complete", payload: { proposalId, proposal } });
  } catch (error) {
    broadcast({
      type: "edit_error",
      payload: {
        proposalId,
        error: error instanceof Error ? error.message : "Could not propose edit.",
      },
    });
  }
}

const httpServer = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
  }

  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname;

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      running: activeRun !== null,
      awaitingApproval: pendingApproval !== null,
      config: latestSnapshot?.config ?? runtimeConfig ?? defaultRunConfig,
      overlayScriptUrl: `http://127.0.0.1:${port}/overlay.js`,
      framework: cachedFramework,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/framework-info") {
    const projectRoot = requestUrl.searchParams.get("projectRoot");
    if (!projectRoot) {
      sendJson(response, 400, { ok: false, message: "projectRoot query parameter is required." });
      return;
    }
    try {
      const framework = await scanProjectFramework(projectRoot);
      cachedFramework = framework;
      sendJson(response, 200, { ok: true, framework });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Could not detect framework.",
      });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/overlay.js") {
    response.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(renderOverlayScript(`http://127.0.0.1:${port}`));
    return;
  }

  if (request.method === "GET" && pathname === "/edit-mode.js") {
    response.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(renderEditModeScript(`http://127.0.0.1:${port}`));
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/runtime/")) {
    const fileName = path.basename(pathname);
    const absolutePath = path.join(runtimeAssetsDir, fileName);

    try {
      const content = await readFile(absolutePath);
      const contentType = fileName.endsWith(".png")
        ? "image/png"
        : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
          ? "image/jpeg"
          : "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end(content);
    } catch {
      sendJson(response, 404, { error: "Runtime asset not found." });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/run") {
    if (activeRun) {
      sendJson(response, 409, { ok: false, message: "A repair run is already in progress." });
      return;
    }

    const body = await readJsonBody<
      Partial<RunConfig> & {
        localEvidence?: RepairStateSnapshot["evidence"];
        localFailureReason?: string;
        localCurrentUrl?: string;
      }
    >(request);
    const config = normalizeRunConfig(body ?? runtimeConfig ?? defaultRunConfig);
    const useLocalFailurePath = Boolean(body?.localEvidence || body?.localFailureReason);

    activeRun = (useLocalFailurePath ? runRepairFromLocalFailure(body ?? config, {
      onState: handleSnapshot,
      onLog: rememberLog,
      requestApproval,
    }) : runRepairLoop(config, {
      onState: handleSnapshot,
      onLog: rememberLog,
      requestApproval,
    }))
      .catch((error) => {
        rememberLog({
          id: `${Date.now()}_run_error`,
          timestamp: new Date().toISOString(),
          level: "error",
          message: error instanceof Error ? error.message : "Unknown run error",
        });
      })
      .finally(() => {
        activeRun = null;
        pendingApproval = null;
      });

    sendJson(response, 202, { ok: true, message: "Repair run started.", config });
    return;
  }

  if (request.method === "POST" && pathname === "/infer-route") {
    const body = await readJsonBody<{
      projectRoot?: string;
      target?: string;
      label?: string;
    }>(request);

    if (!body?.projectRoot || !body?.target) {
      sendJson(response, 400, { ok: false, message: "projectRoot and target are required." });
      return;
    }

    try {
      const candidates = await inferLikelyRoutesForTarget(body.projectRoot, body.target, body.label);
      sendJson(response, 200, {
        ok: true,
        route: candidates[0]?.route ?? null,
        candidates,
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Could not infer a route from the project.",
      });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/approve") {
    if (!pendingApproval) {
      sendJson(response, 409, { ok: false, message: "No pending patch to approve." });
      return;
    }

    pendingApproval.resolve(true);
    pendingApproval = null;
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/reject") {
    if (!pendingApproval) {
      sendJson(response, 409, { ok: false, message: "No pending patch to reject." });
      return;
    }

    pendingApproval.resolve(false);
    pendingApproval = null;
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/inspect/resolve-element") {
    const body = await readJsonBody<{
      element?: ElementDescriptor;
      projectRoot?: string;
      currentUrl?: string;
    }>(request);
    if (!body?.element || !body.projectRoot) {
      sendJson(response, 400, { ok: false, message: "element and projectRoot are required." });
      return;
    }
    try {
      const result = await resolveElementToFile(body.projectRoot, body.element, body.currentUrl);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Could not resolve element to source file.",
      });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/inspect/propose-edit") {
    const body = await readJsonBody<{
      element?: ElementDescriptor;
      mode?: "auto" | "custom";
      customPrompt?: string | null;
      currentUrl?: string;
      projectRoot?: string;
    }>(request);
    if (!body?.element || !body.projectRoot) {
      sendJson(response, 400, { ok: false, message: "element and projectRoot are required." });
      return;
    }

    const proposalId = createSession();
    sendJson(response, 202, { ok: true, proposalId });

    // Process in background — progress broadcast via WebSocket
    const config = latestSnapshot?.config ?? runtimeConfig ?? defaultRunConfig;
    processEditProposal(proposalId, {
      element: body.element,
      mode: body.mode,
      customPrompt: body.customPrompt,
      currentUrl: body.currentUrl,
      projectRoot: body.projectRoot,
    }, config).catch((err) => {
      console.error("Edit proposal processing failed:", err);
    });
    return;
  }

  if (request.method === "POST" && pathname === "/inspect/apply") {
    const body = await readJsonBody<{
      proposalId?: string;
      approved?: boolean;
    }>(request);
    if (!body?.proposalId) {
      sendJson(response, 400, { ok: false, message: "proposalId is required." });
      return;
    }
    try {
      if (body.approved) {
        await applyPatches(body.proposalId);
        sendJson(response, 200, { ok: true, applied: true, revertAvailable: true });
      } else {
        clearSession(body.proposalId);
        sendJson(response, 200, { ok: true, applied: false });
      }
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Could not apply decision.",
      });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/inspect/session") {
    const proposalId = requestUrl.searchParams.get("proposalId");
    if (!proposalId) {
      sendJson(response, 400, { ok: false, message: "proposalId query parameter is required." });
      return;
    }
    const session = getSessionState(proposalId);
    if (!session) {
      sendJson(response, 404, { ok: false, message: "Edit session not found." });
      return;
    }
    sendJson(response, 200, { ok: true, session });
    return;
  }

  if (request.method === "POST" && pathname === "/inspect/revert") {
    const body = await readJsonBody<{
      proposalId?: string;
    }>(request);
    if (!body?.proposalId) {
      sendJson(response, 400, { ok: false, message: "proposalId is required." });
      return;
    }
    try {
      await rollbackSession(body.proposalId);
      clearSession(body.proposalId);
      sendJson(response, 200, { ok: true, reverted: true });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Could not revert applied edit.",
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

const wsServer = new WebSocketServer({ server: httpServer });
const runtimeConfig = await loadRuntimeConfig();

wsServer.on("connection", (socket) => {
  if (latestSnapshot) {
    socket.send(JSON.stringify({ type: "state", payload: latestSnapshot }));
  }

  if (lastLogs.length > 0) {
    socket.send(JSON.stringify({ type: "logs", payload: lastLogs }));
  }

  if (pendingApproval) {
    socket.send(JSON.stringify({ type: "approval_requested", payload: pendingApproval.patch }));
  }
});

await initializeRepairState(runtimeConfig ?? defaultRunConfig, {
  onState: handleSnapshot,
  onLog: rememberLog,
});

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`reform.agent.server listening on http://127.0.0.1:${port}`);
});
