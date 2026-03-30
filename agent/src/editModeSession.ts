import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { EditModeProposal } from "@reform/shared";

interface FileBackup {
  /** Absolute path on disk */
  absolutePath: string;
  /** File content at the time the proposal was generated */
  originalContent: string;
}

interface SessionEntry {
  proposal: EditModeProposal | null;
  backups: FileBackup[];
  projectRoot: string;
  status: "draft" | "applied";
}

const sessions = new Map<string, SessionEntry>();

export function createSession(): string {
  const id = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, { proposal: null, backups: [], projectRoot: "", status: "draft" });
  return id;
}

/**
 * Snapshot a file's content at proposal time.
 * This is the source of truth for patching — we never re-read from disk.
 */
export function storeBackup(proposalId: string, absolutePath: string, originalContent: string): void {
  const session = sessions.get(proposalId);
  if (!session) return;
  const existing = session.backups.find((b) => b.absolutePath === absolutePath);
  if (existing) return;
  session.backups.push({ absolutePath, originalContent });
}

export function setSessionProjectRoot(proposalId: string, projectRoot: string): void {
  const session = sessions.get(proposalId);
  if (!session) return;
  session.projectRoot = projectRoot;
}

export async function populateBackups(_proposalId: string): Promise<void> {
  // No-op: backups are now populated inline via storeBackup
}

/**
 * Apply all patches using the stored snapshots (not live disk content).
 * This ensures patches always apply correctly even if the target project
 * was modified between proposal generation and user acceptance.
 */
export async function applyPatches(proposalId: string): Promise<void> {
  const session = sessions.get(proposalId);
  if (!session || !session.proposal) {
    throw new Error(`No session or proposal found for ${proposalId}.`);
  }

  for (const patch of session.proposal.patches) {
    const absolutePath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(session.projectRoot, patch.filePath);

    // Find the snapshot taken at proposal time
    const backup = session.backups.find((b) => b.absolutePath === absolutePath);
    if (!backup) {
      throw new Error(`No file snapshot found for ${patch.filePath}. This should not happen — report as a bug.`);
    }

    // Apply patch against the snapshot, not the live file
    if (!backup.originalContent.includes(patch.before)) {
      throw new Error(
        `Patch mismatch in ${patch.filePath}: the "before" snippet does not match the file snapshot. The LLM may have generated an incorrect patch.`,
      );
    }

    const patched = backup.originalContent.replace(patch.before, patch.after);
    await writeFile(absolutePath, patched, "utf8");
  }

  session.status = "applied";
}

export async function rollback(proposalId: string): Promise<void> {
  const session = sessions.get(proposalId);
  if (!session) {
    throw new Error(`No session found for proposal ${proposalId}.`);
  }

  for (const backup of session.backups) {
    await writeFile(backup.absolutePath, backup.originalContent, "utf8");
  }

  session.backups = [];
  session.proposal = null;
  session.status = "draft";
}

export function setProposal(proposalId: string, proposal: EditModeProposal): void {
  const session = sessions.get(proposalId);
  if (!session) {
    throw new Error(`No session found for proposal ${proposalId}.`);
  }
  session.proposal = proposal;
}

export function getProposal(proposalId: string): EditModeProposal | null {
  return sessions.get(proposalId)?.proposal ?? null;
}

export function getSessionState(proposalId: string): {
  proposal: EditModeProposal | null;
  status: "draft" | "applied";
  canRevert: boolean;
} | null {
  const session = sessions.get(proposalId);
  if (!session) return null;
  return {
    proposal: session.proposal,
    status: session.status,
    canRevert: session.status === "applied" && session.backups.length > 0,
  };
}

export function clearSession(proposalId: string): void {
  sessions.delete(proposalId);
}
