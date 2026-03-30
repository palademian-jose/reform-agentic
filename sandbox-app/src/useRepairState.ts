import { useEffect, useState } from "react";
import type { RepairStateSnapshot } from "@reform/shared";

const fallbackState: RepairStateSnapshot = {
  run: {
    id: "run_signup_01",
    goal: "Sign up and reach dashboard",
    expectedOutcome: "User lands on /dashboard and sees a welcome panel.",
    stage: "observing",
    targetSelector: "[data-repair-id='signup-card']",
    summary: "Awaiting agent run.",
    retryCount: 0,
    maxRetries: 3,
  },
  config: {
    goal: "Sign up and reach dashboard",
    projectRoot: "/home/deimos/Projects/Reform/sandbox-app",
    appUrl: "http://127.0.0.1:4173",
    requireApproval: true,
    model: "glm-5-turbo",
    browserActions: [
      { kind: "goto", target: "/" },
      { kind: "fill", target: "label:Full name", value: "Jamie Torres" },
      { kind: "fill", target: "label:School email", value: "jamie@school.edu" },
      { kind: "click", target: "role:button:Sign Up" },
      { kind: "wait_for_text", target: "text:Missing required field `name`." }
    ],
    regressionChecks: [
      { path: "/", expectText: "Create account" },
      { path: "/dashboard", expectText: "Welcome to the dashboard" }
    ]
  },
  stage: "observing",
  timestamp: "",
  detail: "Waiting for the agent to start the flow.",
  evidence: {
    consoleErrors: [],
    networkFailures: [],
    domNotes: [],
  },
  patch: {
    filePath: "",
    reason: "",
    diffSummary: "",
  },
  screenshots: {
    beforePath: "",
    afterPath: "",
  },
  pendingPatch: null,
  regressions: [],
};

export function useRepairState() {
  const [state, setState] = useState<RepairStateSnapshot>(fallbackState);

  useEffect(() => {
    let active = true;

    async function loadState() {
      try {
        const response = await fetch(`/repair-state.json?ts=${Date.now()}`);

        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as RepairStateSnapshot;

        if (active) {
          setState(nextState);
        }
      } catch {
        // Keep the last known state when polling fails.
      }
    }

    loadState();

    const interval = window.setInterval(loadState, 1200);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
