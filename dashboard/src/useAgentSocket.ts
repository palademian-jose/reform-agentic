import { useEffect, useState } from "react";
import type { AgentLogEntry, PendingPatch, RepairStateSnapshot } from "@reform/shared";

export function useAgentSocket(agentBaseUrl: string) {
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [pendingPatch, setPendingPatch] = useState<PendingPatch | null>(null);
  const [socketState, setSocketState] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    const wsUrl = agentBaseUrl.replace("http", "ws");
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      setSocketState("open");
    });

    socket.addEventListener("close", () => {
      setSocketState("closed");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as
        | { type: "state"; payload: RepairStateSnapshot }
        | { type: "log"; payload: AgentLogEntry }
        | { type: "logs"; payload: AgentLogEntry[] }
        | { type: "approval_requested"; payload: PendingPatch };

      if (message.type === "log") {
        setLogs((current) => [...current.slice(-99), message.payload]);
      }

      if (message.type === "logs") {
        setLogs(message.payload);
      }

      if (message.type === "state" && !message.payload.pendingPatch) {
        setPendingPatch(null);
      }

      if (message.type === "approval_requested") {
        setPendingPatch(message.payload);
      }
    });

    return () => {
      socket.close();
    };
  }, [agentBaseUrl]);

  return {
    logs,
    pendingPatch,
    socketState,
  };
}
