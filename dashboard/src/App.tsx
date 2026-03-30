import { useEffect, useState } from "react";
import type { RunConfig } from "@reform/shared";
import { stageOrder } from "./mockData";
import { useAgentControl } from "./useAgentControl";
import { useAgentSocket } from "./useAgentSocket";
import { useRepairState } from "./useRepairState";

function formatStage(stage: string) {
  return stage.split("_").join(" ");
}

export function App() {
  const repairState = useRepairState();
  const {
    agentBaseUrl,
    approvePatch,
    awaitingApproval,
    defaultConfig,
    message,
    rejectPatch,
    requestState,
    running,
    triggerRun,
  } = useAgentControl();
  const { logs, pendingPatch, socketState } = useAgentSocket(agentBaseUrl);
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState("");
  const imageSuffix = repairState.timestamp ? `?ts=${encodeURIComponent(repairState.timestamp)}` : "";

  useEffect(() => {
    if (defaultConfig && configText.length === 0) {
      setConfigText(JSON.stringify(defaultConfig, null, 2));
    }
  }, [configText.length, defaultConfig]);

  async function handleRun() {
    try {
      const parsed = JSON.parse(configText) as RunConfig;
      setConfigError("");
      await triggerRun(parsed);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Invalid config JSON.");
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Reform</p>
          <h1>LLM-driven browser repair for arbitrary web projects</h1>
          <p className="lede">
            Inspect a target project, stream live logs, review real patch diffs,
            and approve the repair loop before code is applied.
          </p>
        </div>
        <div className="heroCard">
          <div className="heroCardTop">
            <span className="status status-live">WebSocket {socketState}</span>
            <button className="actionButton" disabled={requestState === "pending" || running} onClick={() => void handleRun()}>
              {running ? "Repair Running" : "Run Repair"}
            </button>
          </div>
          <h2>{repairState.run.goal}</h2>
          <p>{repairState.run.expectedOutcome}</p>
          <p className="agentMessage">{message}</p>
          <dl>
            <div>
              <dt>Stage</dt>
              <dd>{formatStage(repairState.stage)}</dd>
            </div>
            <div>
              <dt>Retry</dt>
              <dd>
                {repairState.run.retryCount}/{repairState.run.maxRetries}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panelHeader">
            <h3>Run Config</h3>
            <span className="status">Arbitrary project input</span>
          </div>
          <textarea
            className="configInput"
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            spellCheck={false}
          />
          {configError ? <p className="errorText">{configError}</p> : null}
        </article>

        <article className="panel">
          <div className="panelHeader">
            <h3>Repair Timeline</h3>
            <span className="status">{formatStage(repairState.stage)}</span>
          </div>
          <ol className="timeline">
            {stageOrder.map((stage) => (
              <li
                key={stage}
                className={
                  stage === repairState.run.stage
                    ? "timelineItem timelineItemActive"
                    : stageOrder.indexOf(stage) < stageOrder.indexOf(repairState.run.stage)
                      ? "timelineItem timelineItemDone"
                      : "timelineItem"
                }
              >
                <span className="timelineDot" />
                <div>
                  <strong>{formatStage(stage)}</strong>
                  <p>{stage === repairState.run.stage ? repairState.detail : "Completed or queued."}</p>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="panel">
          <div className="panelHeader">
            <h3>Live Logs</h3>
            <span className="status">WebSocket stream</span>
          </div>
          <div className="logList">
            {logs.map((entry) => (
              <div className="logEntry" key={entry.id}>
                <strong>{entry.level}</strong>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panelHeader">
            <h3>Failure Evidence</h3>
            <span className="status">Browser + project</span>
          </div>
          <div className="evidenceGroup">
            <h4>Console</h4>
            <ul>
              {repairState.evidence.consoleErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="evidenceGroup">
            <h4>Network</h4>
            <ul>
              {repairState.evidence.networkFailures.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="evidenceGroup">
            <h4>DOM</h4>
            <ul>
              {repairState.evidence.domNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel panelWide">
          <div className="panelHeader">
            <h3>Patch Proposal</h3>
            <span className="status">{pendingPatch ? "Awaiting approval" : "No pending patch"}</span>
          </div>
          {pendingPatch ? (
            <>
              <p className="summary">{pendingPatch.rationale}</p>
              <p className="summary">Confidence: {pendingPatch.confidence}</p>
              <div className="approvalBar">
                <button className="actionButton" disabled={!awaitingApproval} onClick={() => void approvePatch()}>
                  Approve Patch
                </button>
                <button className="ghostButton" disabled={!awaitingApproval} onClick={() => void rejectPatch()}>
                  Reject Patch
                </button>
              </div>
              {pendingPatch.edits.map((edit) => (
                <div className="diffCard" key={`${edit.filePath}-${edit.reason}`}>
                  <strong>{edit.filePath}</strong>
                  <p>{edit.reason}</p>
                  <pre>{edit.diff}</pre>
                </div>
              ))}
            </>
          ) : (
            <p className="summary">{repairState.patch.diffSummary || "No patch proposal yet."}</p>
          )}
        </article>

        <article className="panel panelWide">
          <div className="panelHeader">
            <h3>Visual Evidence</h3>
            <span className="status">Before / after</span>
          </div>
          <div className="shotGrid">
            <div className="shotCard">
              <strong>Before repair</strong>
              {repairState.screenshots.beforePath ? (
                <img alt="Before repair" src={`${repairState.screenshots.beforePath}${imageSuffix}`} />
              ) : (
                <p>No screenshot captured yet.</p>
              )}
            </div>
            <div className="shotCard">
              <strong>After repair</strong>
              {repairState.screenshots.afterPath ? (
                <img alt="After repair" src={`${repairState.screenshots.afterPath}${imageSuffix}`} />
              ) : (
                <p>No verified screenshot captured yet.</p>
              )}
            </div>
          </div>
        </article>

        <article className="panel panelWide">
          <div className="panelHeader">
            <h3>Semantic Regression Checks</h3>
            <span className="status">Post-fix validation</span>
          </div>
          <div className="regressionList">
            {repairState.regressions.map((entry) => (
              <div className={entry.passed ? "regressionItem regressionPass" : "regressionItem regressionFail"} key={`${entry.path}-${entry.detail}`}>
                <strong>{entry.path}</strong>
                <p>{entry.detail}</p>
              </div>
            ))}
            {repairState.regressions.length === 0 ? <p className="summary">No regression checks have run yet.</p> : null}
          </div>
        </article>
      </section>
    </main>
  );
}
