import { useEffect, useState } from "react";
import type { RunConfig } from "@reform/shared";

const agentBaseUrl = import.meta.env.VITE_AGENT_API_URL ?? "http://127.0.0.1:8787";

interface HealthPayload {
  ok: boolean;
  running: boolean;
  awaitingApproval: boolean;
  config: RunConfig;
}

async function postJson(url: string, payload?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const body = (await response.json()) as { ok?: boolean; message?: string; config?: RunConfig };

  if (!response.ok) {
    throw new Error(body.message ?? "Request failed.");
  }

  return body;
}

export function useAgentControl() {
  const [running, setRunning] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [requestState, setRequestState] = useState<"idle" | "pending" | "error">("idle");
  const [message, setMessage] = useState("Agent API idle.");
  const [defaultConfig, setDefaultConfig] = useState<RunConfig | null>(null);

  useEffect(() => {
    let active = true;

    async function pollHealth() {
      try {
        const response = await fetch(`${agentBaseUrl}/health`);

        if (!response.ok) {
          throw new Error("Agent health check failed.");
        }

        const payload = (await response.json()) as HealthPayload;

        if (!active) {
          return;
        }

        setRunning(payload.running);
        setAwaitingApproval(payload.awaitingApproval);
        setDefaultConfig(payload.config);

        if (requestState !== "pending") {
          if (payload.awaitingApproval) {
            setMessage("Patch proposal is waiting for approval.");
          } else {
            setMessage(payload.running ? "Repair run in progress." : "Agent API ready.");
          }
        }
      } catch {
        if (!active) {
          return;
        }

        setRunning(false);
        setAwaitingApproval(false);
        if (requestState !== "pending") {
          setMessage("Agent API offline. Start `npm run --workspace @reform/agent server`.");
        }
      }
    }

    void pollHealth();
    const interval = window.setInterval(() => {
      void pollHealth();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [requestState]);

  async function triggerRun(config: RunConfig) {
    setRequestState("pending");
    setMessage("Starting repair run...");

    try {
      const payload = await postJson(`${agentBaseUrl}/run`, config);
      setMessage(payload.message ?? "Repair run started.");
      setRunning(true);
      setAwaitingApproval(false);
      setRequestState("idle");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Run request failed.");
    }
  }

  async function approvePatch() {
    await postJson(`${agentBaseUrl}/approve`);
    setAwaitingApproval(false);
    setMessage("Patch approved. Agent is continuing.");
  }

  async function rejectPatch() {
    await postJson(`${agentBaseUrl}/reject`);
    setAwaitingApproval(false);
    setMessage("Patch rejected.");
  }

  return {
    agentBaseUrl,
    awaitingApproval,
    defaultConfig,
    message,
    requestState,
    running,
    triggerRun,
    approvePatch,
    rejectPatch,
  };
}
