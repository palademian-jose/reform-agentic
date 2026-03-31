export function renderOverlayScript(agentBaseUrl: string) {
  return `(() => {
  const AGENT_BASE_URL = ${JSON.stringify(agentBaseUrl)};
  const WS_URL = AGENT_BASE_URL.replace(/^http/, "ws");
  const STORAGE_KEY = "__REFORM_OVERLAY_STATE__";

  if (window.__REFORM_OVERLAY__) {
    window.__REFORM_OVERLAY__.open();
    return;
  }

  function loadPersistedState() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const persistedState = loadPersistedState();

  const state = {
    health: null,
    logs: [],
    pendingPatch: null,
    approvalLoading: false,
    repairState: null,
    timeline: [],
    socketState: "connecting",
    configText: persistedState?.configText || "",
    configValidation: { ok: true, message: "Config looks ready to run." },
    selectedElement: null,
    localRun: persistedState?.localRun || null,
    recorderEnabled: Boolean(persistedState?.recorderEnabled),
    recordedActions: Array.isArray(persistedState?.recordedActions) ? persistedState.recordedActions : [],
    recordingInputTarget: null,
    availableTargets: [],
    testSuggestions: [],
    testSuggestionsLoading: false,
    testSuggestionsMessage: "Scan the page to generate code-backed flows.",
    collapsed: persistedState?.collapsed ?? false,
    activeTab: persistedState?.activeTab || "monitor",
    detectedFramework: null,
    editModeEnabled: persistedState?.editModeEnabled ?? false,
    editModeCollapsedBackup: persistedState?.editModeCollapsedBackup ?? null,
    editModeHoverElement: null,
    editModeSelectedElement: null,
    editModePopupVisible: false,
    editModeProposal: null,
    editModeLoading: false,
    editModeCustomPrompt: "",
  };

  let suggestionScanSerial = 0;

  const style = document.createElement("style");
  style.textContent = \`
    #reform-overlay-root {
      position: fixed;
      inset: auto 24px 24px auto;
      display: flex;
      align-items: flex-end;
      width: 460px;
      min-width: 460px;
      max-width: calc(100vw - 24px);
      height: min(820px, calc(100vh - 40px));
      max-height: calc(100vh - 40px);
      z-index: 2147483647;
      font-family: "IBM Plex Sans", sans-serif;
      color: #f6f1e7;
      pointer-events: none;
      transition: width 220ms ease;
    }
    #reform-overlay-root * { box-sizing: border-box; }
    .reform-shell {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      max-height: 100%;
      pointer-events: auto;
      border-radius: 28px;
      overflow: hidden;
      background:
        radial-gradient(circle at top left, rgba(255, 203, 112, 0.14), transparent 36%),
        radial-gradient(circle at top right, rgba(108, 159, 255, 0.18), transparent 34%),
        rgba(13, 17, 26, 0.94);
      border: 1px solid rgba(255,255,255,0.09);
      box-shadow: 0 24px 80px rgba(0,0,0,0.42);
      backdrop-filter: blur(18px);
    }
    #reform-overlay-root.reform-edit-mode-active .reform-shell {
      border-color: rgba(255, 166, 77, 0.85);
      box-shadow:
        0 14px 40px rgba(255, 166, 77, 0.24),
        0 22px 70px rgba(0, 0, 0, 0.42);
    }
    .reform-header {
      display: grid;
      gap: 16px;
      padding: 18px 18px 16px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0)),
        linear-gradient(135deg, rgba(255,200,120,0.18), rgba(97,165,255,0.15));
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .reform-header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .reform-brand {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .reform-title { font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .reform-subtitle {
      font-size: 12px;
      line-height: 1.45;
      color: rgba(255,255,255,0.78);
    }
    .reform-header-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .reform-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .reform-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .reform-toolbar-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .reform-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(255,255,255,0.08); font-size: 12px;
    }
    .reform-badge[data-tone="good"] { background: rgba(113, 217, 170, 0.16); color: #bbf2da; }
    .reform-badge[data-tone="warn"] { background: rgba(255, 195, 107, 0.16); color: #ffe2a7; }
    .reform-badge[data-tone="bad"] { background: rgba(255, 122, 122, 0.16); color: #ffc3c3; }
    .reform-badge[data-tone="neutral"] { background: rgba(255,255,255,0.08); color: #f6f1e7; }
    .reform-icon-button {
      width: 32px;
      height: 32px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      color: inherit;
      cursor: pointer;
      font: 700 16px/1 "IBM Plex Sans", sans-serif;
    }
    .reform-body {
      display: grid;
      gap: 14px;
      padding: 16px 18px 18px;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }
    .reform-tab-bar {
      display: flex;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(13, 17, 26, 0.8);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .reform-tab {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 10px;
      border: none;
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.55);
      font: 600 10px "IBM Plex Sans", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: all 150ms ease;
      position: relative;
    }
    .reform-tab:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.85);
    }
    .reform-tab[aria-selected="true"] {
      background: linear-gradient(135deg, rgba(159, 226, 193, 0.15), rgba(130, 182, 255, 0.15));
      color: #9fe2c1;
    }
    .reform-tab-icon { font-size: 13px; }
    .reform-tab-indicator {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: transparent;
    }
    .reform-tab[data-activity="true"] .reform-tab-indicator {
      background: linear-gradient(135deg, #ffd166, #ffc078);
      box-shadow: 0 0 6px rgba(255, 209, 102, 0.5);
    }
    .reform-tab[data-attention="true"] .reform-tab-indicator {
      background: linear-gradient(135deg, #ff7a7a, #ff4757);
      animation: reformPulse 1s ease-in-out infinite;
    }
    @keyframes reformPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.3); }
    }
    .reform-tab-content {
      display: grid;
      gap: 14px;
    }
    .reform-tab-content[hidden] {
      display: none;
    }
    .reform-section {
      border-radius: 20px; background: rgba(255,255,255,0.045);
      padding: 16px;
      border: 1px solid rgba(255,255,255,0.06);
      display: grid;
      gap: 10px;
    }
    .reform-section h3 {
      margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;
      color: rgba(255,255,255,0.72);
    }
    .reform-helper {
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.66);
      margin-bottom: 12px;
    }
    .reform-meta { font-size: 13px; line-height: 1.45; color: rgba(255,255,255,0.8); }
    .reform-actions, .reform-approval { display: flex; gap: 8px; flex-wrap: wrap; }
    .reform-button, .reform-button-ghost, .reform-button-soft {
      border-radius: 14px;
      padding: 10px 12px;
      font: inherit;
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, color 150ms ease;
    }
    .reform-button:hover, .reform-button-ghost:hover, .reform-button-soft:hover {
      transform: translateY(-1px);
    }
    .reform-button {
      background: linear-gradient(135deg, #9fe2c1, #82b6ff);
      color: #0e121a;
      border: 0;
      box-shadow: 0 10px 24px rgba(86, 140, 255, 0.2);
    }
    .reform-button-ghost {
      background: rgba(255,255,255,0.02);
      color: inherit;
      border: 1px solid rgba(255,255,255,0.14);
    }
    .reform-button-soft {
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      color: inherit;
    }
    .reform-button-soft[data-active="true"] {
      background: linear-gradient(135deg, rgba(255, 180, 122, 0.92), rgba(255, 125, 125, 0.92));
      border-color: rgba(255, 180, 122, 0.3);
      color: #1b1010;
    }
    .reform-button-edit {
      min-width: 108px;
      justify-content: center;
    }
    .reform-button:disabled, .reform-button-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
    .reform-button-soft:disabled { opacity: 0.5; cursor: not-allowed; }
    .reform-loading-card {
      display: grid;
      gap: 10px;
    }
    .reform-skeleton {
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.18), rgba(255,255,255,0.08));
      background-size: 200% 100%;
      animation: reformShimmer 1.1s linear infinite;
    }
    .reform-skeleton-line {
      height: 14px;
    }
    .reform-skeleton-line[data-width="full"] { width: 100%; }
    .reform-skeleton-line[data-width="wide"] { width: 82%; }
    .reform-skeleton-line[data-width="mid"] { width: 64%; }
    .reform-skeleton-diff {
      height: 74px;
    }
    @keyframes reformShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    #reform-success-burst {
      position: fixed;
      inset: 24px;
      display: grid;
      place-items: center;
      pointer-events: none;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 180ms ease;
    }
    #reform-success-burst[data-visible="true"] {
      opacity: 1;
    }
    .reform-success-shell {
      position: relative;
      width: min(360px, calc(100vw - 32px));
      padding: 22px 24px;
      border-radius: 28px;
      background:
        radial-gradient(circle at top, rgba(255, 214, 130, 0.3), transparent 46%),
        rgba(11, 20, 16, 0.94);
      border: 1px solid rgba(180, 255, 211, 0.24);
      box-shadow: 0 26px 90px rgba(0,0,0,0.36);
      text-align: center;
      overflow: hidden;
      transform: translateY(18px) scale(0.94);
      animation: reformSuccessPop 1000ms cubic-bezier(.2,.8,.2,1) forwards;
    }
    .reform-success-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 14px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      color: #062110;
      font: 700 34px/1 "IBM Plex Sans", sans-serif;
      background: linear-gradient(135deg, #d9ff9a, #78f2c6);
      box-shadow: 0 0 0 10px rgba(121, 242, 198, 0.14);
    }
    .reform-success-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .reform-success-copy {
      font-size: 13px;
      color: rgba(255,255,255,0.76);
      line-height: 1.55;
    }
    .reform-success-rays {
      position: absolute;
      inset: -20%;
      background:
        conic-gradient(from 0deg,
          rgba(255,255,255,0) 0deg,
          rgba(217,255,154,0.34) 18deg,
          rgba(255,255,255,0) 36deg,
          rgba(120,242,198,0.28) 56deg,
          rgba(255,255,255,0) 74deg,
          rgba(255,215,141,0.26) 94deg,
          rgba(255,255,255,0) 112deg,
          rgba(217,255,154,0.22) 132deg,
          rgba(255,255,255,0) 150deg,
          rgba(120,242,198,0.24) 170deg,
          rgba(255,255,255,0) 188deg,
          rgba(255,215,141,0.24) 208deg,
          rgba(255,255,255,0) 226deg,
          rgba(217,255,154,0.24) 246deg,
          rgba(255,255,255,0) 264deg,
          rgba(120,242,198,0.24) 284deg,
          rgba(255,255,255,0) 302deg,
          rgba(255,215,141,0.24) 322deg,
          rgba(255,255,255,0) 340deg,
          rgba(217,255,154,0.34) 360deg);
      opacity: 0.5;
      animation: reformSuccessSpin 1600ms linear forwards;
    }
    @keyframes reformSuccessPop {
      0% { transform: translateY(18px) scale(0.94); opacity: 0; }
      20% { transform: translateY(0) scale(1); opacity: 1; }
      80% { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(-8px) scale(0.98); opacity: 0; }
    }
    @keyframes reformSuccessSpin {
      from { transform: rotate(0deg) scale(0.88); }
      to { transform: rotate(120deg) scale(1.06); }
    }
    .reform-textarea {
      width: 100%; min-height: 180px; resize: vertical;
      border-radius: 14px; border: 1px solid rgba(255,255,255,0.08);
      padding: 12px; background: rgba(0,0,0,0.24); color: inherit;
      font: 12px/1.5 "IBM Plex Mono", monospace;
    }
    .reform-textarea[data-invalid="true"] {
      border-color: rgba(255, 122, 122, 0.55);
      box-shadow: inset 0 0 0 1px rgba(255, 122, 122, 0.22);
    }
    .reform-summary-card {
      border-radius: 22px;
      padding: 18px;
      background:
        radial-gradient(circle at top right, rgba(103, 159, 255, 0.12), transparent 38%),
        linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
      border: 1px solid rgba(255,255,255,0.08);
      display: grid;
      gap: 14px;
    }
    .reform-summary-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .reform-summary-title {
      font-size: 15px;
      font-weight: 700;
      line-height: 1.35;
    }
    .reform-summary-detail {
      font-size: 12px;
      line-height: 1.55;
      color: rgba(255,255,255,0.76);
    }
    .reform-summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .reform-stat {
      border-radius: 16px;
      padding: 10px;
      background: rgba(0,0,0,0.16);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255,255,255,0.56);
    }
    .reform-stat-value {
      margin-top: 4px;
      font-size: 13px;
      line-height: 1.4;
      color: rgba(255,255,255,0.92);
    }
    .reform-callout {
      border-radius: 16px;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.55;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.8);
    }
    .reform-log-list, .reform-diff-list, .reform-regressions, .reform-suggestion-list {
      display: grid; gap: 8px;
    }
    .reform-scan-loading {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.72);
      font-size: 12px;
      line-height: 1.5;
    }
    .reform-flow-card {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background:
        radial-gradient(circle at top right, rgba(159, 226, 193, 0.08), transparent 34%),
        rgba(255,255,255,0.04);
    }
    .reform-flow-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .reform-flow-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.35;
      color: #f7f3ea;
    }
    .reform-flow-subtitle {
      margin-top: 4px;
      font-size: 11px;
      line-height: 1.45;
      color: rgba(255,255,255,0.65);
    }
    .reform-flow-file {
      font-size: 11px;
      color: #c8d7ff;
      text-align: right;
      line-height: 1.45;
    }
    .reform-flow-meta {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .reform-flow-steps {
      display: grid;
      gap: 8px;
    }
    .reform-flow-step {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(0,0,0,0.18);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-flow-step-index {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #ffc078, #83b9ff);
      color: #0d1320;
      font-size: 11px;
      font-weight: 700;
      flex: 0 0 auto;
    }
    .reform-flow-step-title {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.4;
      color: #f7f3ea;
    }
    .reform-flow-step-copy {
      margin-top: 2px;
      font-size: 11px;
      line-height: 1.45;
      color: rgba(255,255,255,0.68);
    }
    .reform-flow-fns {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .reform-flow-pill {
      border-radius: 999px;
      padding: 5px 8px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 11px;
      color: rgba(255,255,255,0.8);
    }
    .reform-flow-action {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      align-items: center;
      padding-top: 2px;
    }
    .reform-suggestion-empty {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: 18px;
      border: 1px dashed rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.03);
      color: rgba(255,255,255,0.74);
      line-height: 1.55;
    }
    .reform-suggestion-empty strong {
      color: #f7f3ea;
    }
    .reform-grid-two {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .reform-control-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: end;
    }
    .reform-control-row .reform-field:first-child {
      min-width: 0;
    }
    .reform-recorder-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .reform-log, .reform-diff, .reform-regression {
      border-radius: 14px; background: rgba(0,0,0,0.2); padding: 10px;
      font-size: 12px; line-height: 1.45;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-recorder-item {
      border-radius: 14px;
      background: rgba(0,0,0,0.2);
      padding: 10px;
      font-size: 12px;
      line-height: 1.45;
    }
    .reform-recorder-row,
    .reform-suggestion-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      justify-content: space-between;
    }
    .reform-mini-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .reform-mini-button {
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      padding: 6px 8px;
    }
    .reform-diff pre {
      margin: 8px 0 0; padding: 10px; border-radius: 10px; overflow: auto;
      background: rgba(6,10,17,0.8); color: #d8f5dd;
      font: 11px/1.45 "IBM Plex Mono", monospace;
    }
    .reform-log-head,
    .reform-regression-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .reform-log-level {
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 10px;
      color: rgba(255,255,255,0.65);
    }
    .reform-log-time {
      font-size: 10px;
      color: rgba(255,255,255,0.48);
    }
    .reform-empty {
      border-radius: 14px;
      padding: 12px;
      background: rgba(255,255,255,0.04);
      border: 1px dashed rgba(255,255,255,0.1);
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.68);
    }
    .reform-validation {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 12px;
      line-height: 1.55;
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.78);
    }
    .reform-validation[data-tone="good"] {
      background: rgba(113, 217, 170, 0.1);
      border-color: rgba(113, 217, 170, 0.2);
      color: #ccf6e4;
    }
    .reform-validation[data-tone="bad"] {
      background: rgba(255, 122, 122, 0.1);
      border-color: rgba(255, 122, 122, 0.22);
      color: #ffd0d0;
    }
    .reform-field {
      display: grid;
      gap: 6px;
    }
    .reform-field label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255,255,255,0.56);
    }
    .reform-input,
    .reform-select {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(0,0,0,0.22);
      color: inherit;
      padding: 10px 12px;
      font: 12px/1.45 "IBM Plex Sans", sans-serif;
    }
    .reform-builder {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      margin-top: 12px;
    }
    .reform-builder-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .reform-shots {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .reform-shot {
      border-radius: 16px;
      overflow: hidden;
      background: rgba(0,0,0,0.22);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .reform-shot-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 10px 8px;
    }
    .reform-shot img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      background: rgba(255,255,255,0.04);
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .reform-shot-empty {
      padding: 12px;
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.66);
    }
    .reform-evidence-grid {
      display: grid;
      gap: 10px;
    }
    .reform-evidence-card {
      border-radius: 14px;
      padding: 12px;
      background: rgba(0,0,0,0.18);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-evidence-card[data-tone="good"] {
      border-color: rgba(113, 217, 170, 0.2);
      background: rgba(113, 217, 170, 0.08);
    }
    .reform-evidence-card[data-tone="warn"] {
      border-color: rgba(255, 195, 107, 0.2);
      background: rgba(255, 195, 107, 0.08);
    }
    .reform-evidence-card[data-tone="bad"] {
      border-color: rgba(255, 122, 122, 0.22);
      background: rgba(255, 122, 122, 0.08);
    }
    .reform-evidence-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .reform-evidence-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .reform-evidence-item {
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.78);
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
    }
    .reform-timeline {
      display: grid;
      gap: 10px;
    }
    .reform-timeline-item {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 10px;
      align-items: flex-start;
      padding: 10px;
      border-radius: 14px;
      background: rgba(0,0,0,0.18);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-timeline-time {
      font-size: 11px;
      color: rgba(255,255,255,0.52);
      padding-top: 2px;
    }
    .reform-timeline-title {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.45;
    }
    .reform-timeline-detail {
      margin-top: 3px;
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.72);
    }
    .reform-step-list {
      display: grid;
      gap: 10px;
    }
    .reform-step {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px;
      border-radius: 14px;
      background: rgba(0,0,0,0.18);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .reform-step-index {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: #0d1320;
      background: linear-gradient(135deg, #ffc078, #83b9ff);
      flex: 0 0 auto;
      margin-top: 1px;
    }
    .reform-step strong {
      display: block;
      margin-bottom: 2px;
    }
    .reform-step div:last-child {
      font-size: 12px;
      line-height: 1.5;
      color: rgba(255,255,255,0.72);
    }
    .reform-collapsed #reform-overlay-panel { display: none; }
    #reform-approval-popout {
      position: fixed;
      right: 496px;
      bottom: 24px;
      width: min(360px, calc(100vw - 24px));
      max-height: calc(100vh - 40px);
      z-index: 2147483648;
      pointer-events: none;
      transition: right 220ms ease, opacity 180ms ease, transform 180ms ease;
    }
    #reform-approval-popout[data-visible="false"] {
      opacity: 0;
      transform: translateY(8px);
    }
    #reform-approval-popout[data-visible="true"] {
      opacity: 1;
      transform: translateY(0);
    }
    .reform-popout-shell {
      pointer-events: auto;
      border-radius: 24px;
      overflow: hidden;
      background:
        radial-gradient(circle at top right, rgba(255, 189, 96, 0.16), transparent 34%),
        rgba(13, 17, 26, 0.96);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 24px 72px rgba(0,0,0,0.38);
      backdrop-filter: blur(16px);
    }
    .reform-popout-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 16px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .reform-popout-body {
      display: grid;
      gap: 12px;
      padding: 14px 16px 16px;
      max-height: calc(100vh - 110px);
      overflow: auto;
    }
    .reform-toggle {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483652;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 132px;
      min-height: 52px;
      padding: 14px 22px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      touch-action: manipulation;
      user-select: none;
      font: 700 13px "IBM Plex Sans", sans-serif;
      line-height: 1;
      letter-spacing: 0.02em;
      background: linear-gradient(135deg, #ffc078, #83b9ff); color: #0d1320;
      box-shadow: 0 16px 40px rgba(0,0,0,0.35);
      pointer-events: auto;
      transform: translateZ(0);
    }
    .reform-toggle[data-open="true"] {
      background: rgba(13, 17, 26, 0.9);
      color: #f6f1e7;
      border: 1px solid rgba(255,255,255,0.1);
    }
    @media (max-width: 640px) {
      #reform-overlay-root {
        inset: auto 12px 12px 12px;
        width: auto;
        min-width: 0;
        height: min(760px, calc(100vh - 24px));
        max-height: calc(100vh - 24px);
      }
      #reform-approval-popout {
        left: 12px;
        right: 12px;
        bottom: 162px;
        width: auto;
      }
      .reform-summary-grid {
        grid-template-columns: 1fr;
      }
      .reform-control-row {
        grid-template-columns: 1fr;
      }
      .reform-grid-two,
      .reform-shots {
        grid-template-columns: 1fr;
      }
    }
    .reform-highlight {
      outline: 3px solid rgba(255, 193, 106, 0.95) !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 0 9999px rgba(255, 193, 106, 0.08), 0 0 28px rgba(255, 193, 106, 0.35) !important;
      transition: all 180ms ease;
    }
    #reform-playback-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 2px solid rgba(255,255,255,0.94);
      background: rgba(94, 171, 255, 0.34);
      box-shadow:
        0 0 0 8px rgba(94, 171, 255, 0.14),
        0 12px 28px rgba(0, 0, 0, 0.22);
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 2147483647;
      opacity: 0;
      transition:
        left 140ms ease,
        top 140ms ease,
        transform 120ms ease,
        box-shadow 120ms ease,
        opacity 120ms ease;
    }
    #reform-playback-cursor[data-visible="true"] {
      opacity: 1;
    }
    #reform-playback-cursor[data-clicking="true"] {
      transform: translate(-50%, -50%) scale(0.86);
      box-shadow:
        0 0 0 14px rgba(255, 193, 107, 0.18),
        0 14px 30px rgba(0, 0, 0, 0.25);
    }
  \`;
  document.head.appendChild(style);

  const toggle = document.createElement("button");
  toggle.className = "reform-toggle";
  toggle.textContent = "Reform";

  const root = document.createElement("div");
  root.id = "reform-overlay-root";
  root.className = "reform-collapsed";
  root.innerHTML = \`
    <div id="reform-overlay-panel" class="reform-shell">
      <div class="reform-header">
        <div class="reform-header-top">
          <div class="reform-brand">
            <div class="reform-title">Reform Overlay</div>
            <div class="reform-subtitle">Run, inspect, and review repairs.</div>
            <div class="reform-header-meta">
              <div class="reform-badge" id="reform-framework-badge" data-tone="neutral" style="display:none">\u2014</div>
              <div class="reform-badge" id="reform-model-badge" data-tone="neutral">LLM: \u2014</div>
              <div class="reform-badge" id="reform-overlay-status" data-tone="neutral">Connecting</div>
            </div>
          </div>
          <div class="reform-header-actions">
            <button class="reform-icon-button" id="reform-collapse-button" aria-label="Collapse Reform overlay">−</button>
          </div>
        </div>
        <div class="reform-toolbar">
          <div class="reform-toolbar-group">
            <button class="reform-button" id="reform-run-button">Run In This Tab</button>
            <button class="reform-button-soft" id="reform-record-button">Start Recording</button>
            <button class="reform-button-soft reform-button-edit" id="reform-edit-mode-toggle" data-active="false">Edit Mode</button>
          </div>
          <div class="reform-toolbar-group">
            <button class="reform-button-ghost" id="reform-clear-recording-button">Clear Steps</button>
          </div>
        </div>
        <div class="reform-callout" id="reform-guidance">Connecting to the local Reform agent.</div>
      </div>
      <div class="reform-tab-bar" role="tablist">
        <button class="reform-tab" data-tab="monitor" role="tab" aria-selected="true">
          <span class="reform-tab-icon">\u25C9</span>
          <span class="reform-tab-label">Monitor</span>
          <span class="reform-tab-indicator"></span>
        </button>
        <button class="reform-tab" data-tab="build" role="tab" aria-selected="false">
          <span class="reform-tab-icon">\u2699</span>
          <span class="reform-tab-label">Build</span>
          <span class="reform-tab-indicator"></span>
        </button>
        <button class="reform-tab" data-tab="evidence" role="tab" aria-selected="false">
          <span class="reform-tab-icon">\u25CE</span>
          <span class="reform-tab-label">Evidence</span>
          <span class="reform-tab-indicator"></span>
        </button>
        <button class="reform-tab" data-tab="review" role="tab" aria-selected="false">
          <span class="reform-tab-icon">\u2713</span>
          <span class="reform-tab-label">Review</span>
          <span class="reform-tab-indicator"></span>
        </button>
      </div>
      <div class="reform-body">
        <div class="reform-tab-content" data-panel="monitor" role="tabpanel">
        <section class="reform-section">
          <h3>Run Overview</h3>
          <div class="reform-summary-card">
            <div class="reform-summary-head">
              <div>
                <div class="reform-summary-title" id="reform-summary-title">Waiting for agent state</div>
                <div class="reform-summary-detail" id="reform-summary-detail">No run metadata has been received yet.</div>
              </div>
              <div class="reform-badge" id="reform-stage-badge" data-tone="neutral">Idle</div>
            </div>
            <div class="reform-summary-grid">
              <div class="reform-stat">
                <div class="reform-stat-label">Goal</div>
                <div class="reform-stat-value" id="reform-goal-value">Not available</div>
              </div>
              <div class="reform-stat">
                <div class="reform-stat-label">Current Stage</div>
                <div class="reform-stat-value" id="reform-stage-value">Not available</div>
              </div>
              <div class="reform-stat">
                <div class="reform-stat-label">Model</div>
                <div class="reform-stat-value" id="reform-model-value">\u2014</div>
              </div>
              <div class="reform-stat">
                <div class="reform-stat-label">Approval State</div>
                <div class="reform-stat-value" id="reform-approval-value">No pending decisions</div>
              </div>
            </div>
            <div class="reform-callout" id="reform-next-step">Waiting for the agent to publish the first state update.</div>
          </div>
          <div class="reform-helper" id="reform-run-meta">Waiting for agent state.</div>
          <div class="reform-builder">
            <div class="reform-helper" style="margin-bottom:0">Build steps inline. Refresh targets to rescan the page.</div>
            <div class="reform-control-row">
              <div class="reform-field">
                <label for="reform-action-target">Page Target</label>
                <select id="reform-action-target" class="reform-select"></select>
              </div>
              <div class="reform-field">
                <label for="reform-action-kind">Step Kind</label>
                <select id="reform-action-kind" class="reform-select">
                  <option value="click">Click</option>
                  <option value="fill">Fill</option>
                  <option value="hover">Hover</option>
                  <option value="wait_for_text">Wait For Text</option>
                  <option value="wait_for_url">Wait For URL</option>
                </select>
              </div>
              <button class="reform-button-ghost" id="reform-refresh-targets-button">Refresh</button>
            </div>
            <div class="reform-field">
              <label for="reform-action-value">Value Or Match Text</label>
              <input id="reform-action-value" class="reform-input" placeholder="Only needed for fill and wait steps" />
            </div>
            <div class="reform-builder-actions">
              <button class="reform-button-ghost" id="reform-add-step-button">Add Step</button>
            </div>
          </div>
          <div class="reform-recorder-list" id="reform-recorder-list"></div>
        </section>
        <section class="reform-section">
          <h3>Timeline</h3>
          <div class="reform-timeline" id="reform-timeline"></div>
        </section>
        <section class="reform-section">
          <h3>Logs</h3>
          <div class="reform-log-list" id="reform-log-list"></div>
        </section>
        </div>
        <div class="reform-tab-content" data-panel="build" role="tabpanel" hidden>
        <section class="reform-section">
          <h3>Code-Backed Flows</h3>
          <div class="reform-helper">Scan the current page to map visible buttons to source files, testable functions, and a clearer flow.</div>
          <div class="reform-actions">
            <button class="reform-button-ghost" id="reform-scan-button">Scan Current Page</button>
          </div>
          <div class="reform-suggestion-list" id="reform-suggestion-list" style="margin-top:10px"></div>
        </section>
        <section class="reform-section">
          <h3>Config</h3>
          <div class="reform-helper">Recording and suggestions update this config when possible.</div>
          <div class="reform-grid-two" style="margin-bottom:10px">
            <div class="reform-field">
              <label for="reform-llm-provider">LLM Provider</label>
              <select id="reform-llm-provider" class="reform-select">
                <option value="openrouter">OpenRouter</option>
                <option value="zai">z.ai</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div class="reform-field">
              <label for="reform-llm-model">Model</label>
              <input id="reform-llm-model" class="reform-input" placeholder="x-ai/grok-4-fast" />
            </div>
          </div>
          <div class="reform-helper">Fallback is fixed to z.ai.</div>
          <textarea id="reform-config" class="reform-textarea"></textarea>
          <div class="reform-validation" id="reform-config-validation" data-tone="good">Config looks ready to run.</div>
        </section>
        </div>
        <div class="reform-tab-content" data-panel="evidence" role="tabpanel" hidden>
        <section class="reform-section">
          <h3>Visual Diff</h3>
          <div class="reform-helper">Before and after captures for UI-facing changes.</div>
          <div class="reform-shots" id="reform-shot-grid"></div>
        </section>
        <section class="reform-section">
          <h3>Evidence</h3>
          <div class="reform-helper">Browser signals grouped by severity.</div>
          <div class="reform-evidence-grid" id="reform-evidence-grid"></div>
        </section>
        <section class="reform-section">
          <h3>Regressions</h3>
          <div class="reform-helper">Nearby checks run after the main flow passes.</div>
          <div class="reform-regressions" id="reform-regressions"></div>
        </section>
        </div>
        <div class="reform-tab-content" data-panel="review" role="tabpanel" hidden>
        <section class="reform-section" id="reform-approval-section" style="display:none">
          <h3>Patch Approval</h3>
          <div class="reform-helper">Review the rationale and diff before approving.</div>
          <div class="reform-meta" id="reform-patch-rationale"></div>
          <div class="reform-approval" style="margin-top:10px">
            <button class="reform-button" id="reform-approve-button">Approve Patch</button>
            <button class="reform-button-ghost" id="reform-reject-button">Reject Patch</button>
          </div>
          <div class="reform-diff-list" id="reform-diff-list" style="margin-top:10px"></div>
        </section>
        <div class="reform-empty" id="reform-review-empty">No patches pending review. When the agent proposes a fix, it will appear here automatically.</div>
        </div>
      </div>
    </div>
  \`;
  document.body.appendChild(root);

  const approvalPopout = document.createElement("div");
  approvalPopout.id = "reform-approval-popout";
  approvalPopout.dataset.visible = "false";
  approvalPopout.innerHTML = \`
    <div class="reform-popout-shell">
      <div class="reform-popout-head">
        <div>
          <div class="reform-title">Approval Needed</div>
          <div class="reform-subtitle">A patch proposal is waiting for a decision. This panel stays separate so approval requests are harder to miss.</div>
        </div>
        <div class="reform-badge" data-tone="warn">Pending</div>
      </div>
      <div class="reform-popout-body">
        <div class="reform-callout" id="reform-popout-summary">No pending patch.</div>
        <div class="reform-approval">
          <button class="reform-button" id="reform-popout-approve-button">Approve Patch</button>
          <button class="reform-button-ghost" id="reform-popout-reject-button">Reject Patch</button>
        </div>
        <div class="reform-diff-list" id="reform-popout-diff-list"></div>
      </div>
    </div>
  \`;
  document.body.appendChild(approvalPopout);

  const successBurst = document.createElement("div");
  successBurst.id = "reform-success-burst";
  successBurst.dataset.visible = "false";
  successBurst.innerHTML = \`
    <div class="reform-success-shell">
      <div class="reform-success-rays"></div>
      <div class="reform-success-icon">✓</div>
      <div class="reform-success-title">Repair Verified</div>
      <div class="reform-success-copy">The latest run reached the expected result and stayed healthy through validation.</div>
    </div>
  \`;
  document.body.appendChild(successBurst);
  document.body.appendChild(toggle);

  const els = {
    frameworkBadge: root.querySelector("#reform-framework-badge"),
    modelBadge: root.querySelector("#reform-model-badge"),
    status: root.querySelector("#reform-overlay-status"),
    guidance: root.querySelector("#reform-guidance"),
    collapseButton: root.querySelector("#reform-collapse-button"),
    summaryTitle: root.querySelector("#reform-summary-title"),
    summaryDetail: root.querySelector("#reform-summary-detail"),
    stageBadge: root.querySelector("#reform-stage-badge"),
    goalValue: root.querySelector("#reform-goal-value"),
    stageValue: root.querySelector("#reform-stage-value"),
    modelValue: root.querySelector("#reform-model-value"),
    approvalValue: root.querySelector("#reform-approval-value"),
    nextStep: root.querySelector("#reform-next-step"),
    runMeta: root.querySelector("#reform-run-meta"),
    runButton: root.querySelector("#reform-run-button"),
    recordButton: root.querySelector("#reform-record-button"),
    editModeToggle: root.querySelector("#reform-edit-mode-toggle"),
    actionKind: root.querySelector("#reform-action-kind"),
    actionTarget: root.querySelector("#reform-action-target"),
    actionValue: root.querySelector("#reform-action-value"),
    refreshTargetsButton: root.querySelector("#reform-refresh-targets-button"),
    addStepButton: root.querySelector("#reform-add-step-button"),
    clearRecordingButton: root.querySelector("#reform-clear-recording-button"),
    recorderList: root.querySelector("#reform-recorder-list"),
    scanButton: root.querySelector("#reform-scan-button"),
    suggestionList: root.querySelector("#reform-suggestion-list"),
    config: root.querySelector("#reform-config"),
    llmProvider: root.querySelector("#reform-llm-provider"),
    llmModel: root.querySelector("#reform-llm-model"),
    configValidation: root.querySelector("#reform-config-validation"),
    timeline: root.querySelector("#reform-timeline"),
    shotGrid: root.querySelector("#reform-shot-grid"),
    evidenceGrid: root.querySelector("#reform-evidence-grid"),
    approvalSection: root.querySelector("#reform-approval-section"),
    patchRationale: root.querySelector("#reform-patch-rationale"),
    diffList: root.querySelector("#reform-diff-list"),
    approveButton: root.querySelector("#reform-approve-button"),
    rejectButton: root.querySelector("#reform-reject-button"),
    popoutSummary: approvalPopout.querySelector("#reform-popout-summary"),
    popoutDiffList: approvalPopout.querySelector("#reform-popout-diff-list"),
    popoutApproveButton: approvalPopout.querySelector("#reform-popout-approve-button"),
    popoutRejectButton: approvalPopout.querySelector("#reform-popout-reject-button"),
    logList: root.querySelector("#reform-log-list"),
    regressions: root.querySelector("#reform-regressions"),
  };

  const stageCopy = {
    observing: {
      title: "Opening the app and reproducing the requested flow",
      detail: "Reform is driving the browser to observe the current behavior before it decides whether a repair is needed.",
      next: "Wait for the first evidence summary. If the flow succeeds cleanly, the overlay should skip repair and move directly to regression checks.",
      tone: "neutral",
    },
    analyzing: {
      title: "Inspecting evidence from the current run",
      detail: "The agent is summarizing browser signals such as current URL, visible body text, console errors, and request failures.",
      next: "If the flow actually failed, the next step is candidate file targeting. If the flow passed, the next step should be regression validation only.",
      tone: "neutral",
    },
    tracing_issue: {
      title: "Targeting likely source files for repair",
      detail: "The agent believes the primary flow failed and is packaging evidence so the model can propose a constrained patch.",
      next: "Review whether this stage is justified. If your test flow passed, the agent should not be here.",
      tone: "warn",
    },
    proposing_patch: {
      title: "Patch proposal is ready",
      detail: "A candidate edit has been generated from the captured evidence and candidate files.",
      next: "Read the rationale and inspect the diff below before approving the patch.",
      tone: "warn",
    },
    awaiting_approval: {
      title: "Waiting for operator approval",
      detail: "No code will be modified until the proposed patch is explicitly approved.",
      next: "Approve if the diff is narrow and defensible. Reject if the model targeted the wrong file or the reasoning is weak.",
      tone: "warn",
    },
    applying_fix: {
      title: "Applying the approved edit",
      detail: "The patch has been accepted and is being written into the target project.",
      next: "The app should reload next. After that Reform replays the primary flow.",
      tone: "neutral",
    },
    rebuilding: {
      title: "Waiting for the app to rebuild",
      detail: "Reform is pausing while the dev server reloads the updated code and the page becomes stable again.",
      next: "If rebuild takes too long, inspect the app terminal for compile errors or a stalled dev server.",
      tone: "neutral",
    },
    retesting: {
      title: "Replaying the primary flow",
      detail: "The main test flow is running again against the updated app to confirm the issue is actually resolved.",
      next: "A successful replay should be followed by regression checks, not another patch proposal.",
      tone: "neutral",
    },
    running_regressions: {
      title: "Checking nearby regressions",
      detail: "The primary flow is already healthy, and Reform is now validating adjacent routes or expectations for collateral damage.",
      next: "If all checks pass, the run will move to verified.",
      tone: "neutral",
    },
    verified: {
      title: "Run verified",
      detail: "The primary flow completed successfully and the configured regression checks are healthy.",
      next: "You can keep the overlay open to inspect logs, recorded steps, and the last-used config for the next run.",
      tone: "good",
    },
    needs_review: {
      title: "Run needs review",
      detail: "Reform reached a blocker, a rejected patch, or a regression failure that requires human review.",
      next: "Read the logs and regression results to decide whether the issue is with the test flow, the patch, or the app itself.",
      tone: "bad",
    },
  };

  function escapeHtml(text) {
    return String(text).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char]));
  }

  function persistOverlayState() {
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          configText: state.configText,
          localRun: state.localRun,
          recordedActions: state.recordedActions,
          recorderEnabled: state.recorderEnabled,
          collapsed: state.collapsed,
          activeTab: state.activeTab,
          editModeEnabled: state.editModeEnabled,
          editModeCollapsedBackup: state.editModeCollapsedBackup,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    root.querySelectorAll(".reform-tab").forEach(function(tab) {
      tab.setAttribute("aria-selected", tab.dataset.tab === tabId);
      // Clear activity indicator for the selected tab
      if (tab.dataset.tab === tabId) {
        tab.dataset.activity = "false";
        tab.dataset.attention = "false";
      }
    });
    root.querySelectorAll(".reform-tab-content").forEach(function(panel) {
      panel.toggleAttribute("hidden", panel.dataset.panel !== tabId);
    });
    persistOverlayState();
  }

  function flagTabActivity(tabId, type) {
    // type: "activity" for new content, "attention" for needs action
    var tab = root.querySelector('.reform-tab[data-tab="' + tabId + '"]');
    if (!tab || tab.dataset.tab === state.activeTab) return;
    tab.dataset.activity = type === "activity" ? "true" : "false";
    tab.dataset.attention = type === "attention" ? "true" : "false";
  }

  // Wire up tab clicks
  root.querySelectorAll(".reform-tab").forEach(function(tab) {
    tab.addEventListener("click", function() { switchTab(tab.dataset.tab); });
  });

  // Restore active tab from persistence
  if (state.activeTab && state.activeTab !== "monitor") {
    switchTab(state.activeTab);
  }

  function formatTime(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "";
    }
  }

  function prettifyStage(stage) {
    return String(stage || "unknown").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function prettifyProvider(provider) {
    if (!provider) return "Unknown";
    if (provider === "zai") return "z.ai";
    if (provider === "openrouter") return "OpenRouter";
    if (provider === "openai") return "OpenAI";
    return provider;
  }

  function getEditableConfig() {
    try {
      return JSON.parse(els.config.value || state.configText || "{}");
    } catch {
      return null;
    }
  }

  function getActiveModel(repairState) {
    const editableConfig = getEditableConfig();
    return (
      repairState?.config?.model ||
      state.localRun?.config?.model ||
      state.health?.config?.model ||
      editableConfig?.model ||
      "Unknown"
    );
  }

  function getActiveProvider(repairState) {
    const editableConfig = getEditableConfig();
    return (
      repairState?.config?.llmProvider ||
      state.localRun?.config?.llmProvider ||
      state.health?.config?.llmProvider ||
      editableConfig?.llmProvider ||
      "openrouter"
    );
  }

  function syncLlmControlsFromConfig(config) {
    const provider = config?.llmProvider || "openrouter";
    const model = config?.model || "";
    els.llmProvider.value = provider;
    els.llmModel.value = model;
  }

  function renderEditToggle() {
    els.editModeToggle.textContent = state.editModeEnabled ? "Exit Edit" : "Edit Mode";
    els.editModeToggle.dataset.active = state.editModeEnabled ? "true" : "false";
  }

  async function ensureEditModeScript() {
    if (window.__REFORM_EDIT_MODE__) {
      return;
    }

    const script = document.createElement("script");
    script.src = AGENT_BASE_URL + "/edit-mode.js";
    document.head.appendChild(script);
    await new Promise((resolve) => {
      script.onload = resolve;
    });
  }

  async function toggleEditMode() {
    await ensureEditModeScript();
    if (state.editModeEnabled) {
      window.__REFORM_EDIT_MODE__?.disable();
      state.editModeEnabled = false;
      if (state.editModeCollapsedBackup !== null) {
        setCollapsed(state.editModeCollapsedBackup);
        state.editModeCollapsedBackup = null;
      }
    } else {
      state.editModeCollapsedBackup = state.collapsed;
      setCollapsed(true);
      window.__REFORM_EDIT_MODE__?.enable();
      state.editModeEnabled = true;
    }
    applyEditModeVisuals(state.editModeEnabled);
    renderEditToggle();
    persistOverlayState();
  }

  function exitEditModeAndOpenOverlay() {
    if (state.editModeEnabled && window.__REFORM_EDIT_MODE__) {
      window.__REFORM_EDIT_MODE__.disable();
      state.editModeEnabled = false;
      state.editModeCollapsedBackup = null;
      applyEditModeVisuals(false);
      renderEditToggle();
      persistOverlayState();
    }
    setCollapsed(false);
  }

  function updateConfigFromLlmControls() {
    try {
      const parsed = JSON.parse(els.config.value || "{}");
      parsed.llmProvider = els.llmProvider.value || "openrouter";
      parsed.llmFallbackProvider = "zai";
      parsed.model = els.llmModel.value.trim() || parsed.model || "x-ai/grok-4-fast";
      els.config.value = JSON.stringify(parsed, null, 2);
      state.configText = els.config.value;
      validateConfigEditor();
      persistOverlayState();
    } catch {
      // Keep manual config editing independent from control updates.
    }
  }

  function createRunRecord(config, stage, detail, options = {}) {
    return {
      active: true,
      awaitingPatchedRetry: options.awaitingPatchedRetry ?? false,
      config,
      nextIndex: options.nextIndex ?? 0,
      snapshot: {
        run: {
          id: options.runId || ("overlay_run_" + Date.now()),
          goal: config.goal,
          expectedOutcome: "Primary flow completes in the current browser tab.",
          stage,
          summary: detail,
          retryCount: options.retryCount ?? 1,
          maxRetries: options.maxRetries ?? 3,
        },
        config,
        stage,
        timestamp: new Date().toISOString(),
        detail,
        evidence: options.evidence || {
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
        regressions: options.regressions || [],
      },
    };
  }

  function pushLocalLog(level, message) {
    state.logs.push({
      id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  function setLocalRunStage(stage, detail, options = {}) {
    const currentConfig =
      (state.localRun && state.localRun.config) ||
      JSON.parse(state.configText || "{}");
    const currentRunId = state.localRun?.snapshot?.run?.id;
    state.localRun = createRunRecord(currentConfig, stage, detail, {
      nextIndex: options.nextIndex ?? state.localRun?.nextIndex ?? 0,
      awaitingPatchedRetry: options.awaitingPatchedRetry ?? state.localRun?.awaitingPatchedRetry ?? false,
      runId: currentRunId,
      evidence: options.evidence ?? state.localRun?.snapshot?.evidence,
      regressions: options.regressions ?? state.localRun?.snapshot?.regressions,
      retryCount: options.retryCount ?? state.localRun?.snapshot?.run?.retryCount ?? 1,
      maxRetries: options.maxRetries ?? state.localRun?.snapshot?.run?.maxRetries ?? 3,
    });
    state.localRun.snapshot.run.summary = detail;
    persistOverlayState();
    renderState();
  }

  function completeLocalRun(stage, detail, options = {}) {
    setLocalRunStage(stage, detail, options);
    if (state.localRun) {
      state.localRun.active = false;
      state.localRun.awaitingPatchedRetry = false;
      persistOverlayState();
      renderState();
    }
    if (stage === "verified") {
      triggerSuccessBurst();
    }
  }

  function ensurePlaybackCursor() {
    let cursor = document.getElementById("reform-playback-cursor");
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.id = "reform-playback-cursor";
      cursor.setAttribute("data-visible", "false");
      document.documentElement.appendChild(cursor);
    }
    return cursor;
  }

  function setPlaybackCursor(point, clicking) {
    const cursor = ensurePlaybackCursor();
    cursor.setAttribute("data-visible", "true");
    cursor.setAttribute("data-clicking", clicking ? "true" : "false");
    cursor.style.left = point.x + "px";
    cursor.style.top = point.y + "px";
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function getElementText(element) {
    return (element?.innerText || element?.textContent || "").trim();
  }

  function findByText(text) {
    const needle = String(text || "").trim();
    if (!needle) return null;
    const candidates = Array.from(document.querySelectorAll("button, a, label, div, span, p, h1, h2, h3, h4"));
    return candidates.find((element) => isVisible(element) && getElementText(element).includes(needle)) || null;
  }

  function findByRole(role, name) {
    const roleNeedle = String(role || "").trim();
    const nameNeedle = String(name || "").trim();
    const candidates = Array.from(document.querySelectorAll("[role], button, a, input, textarea, select"));
    return (
      candidates.find((element) => {
        const inferredRole =
          element.getAttribute("role") ||
          (element.tagName === "BUTTON" ? "button" : element.tagName === "A" ? "link" : "");
        if (inferredRole !== roleNeedle) return false;
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("value") ||
          getElementText(element);
        return isVisible(element) && label.trim() === nameNeedle;
      }) || null
    );
  }

  function findByLabel(labelText) {
    const needle = String(labelText || "").trim();
    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find((entry) => getElementText(entry) === needle);
    if (!label) return null;
    const forId = label.getAttribute("for");
    if (forId) {
      return document.getElementById(forId);
    }
    return label.querySelector("input, textarea, select");
  }

  function resolveActionTarget(target) {
    if (!target) return null;
    if (target.startsWith("label:")) return findByLabel(target.slice(6));
    if (target.startsWith("role:")) {
      const parts = target.split(":");
      return findByRole(parts[1], parts.slice(2).join(":"));
    }
    if (target.startsWith("text:")) return findByText(target.slice(5));
    try {
      return document.querySelector(target);
    } catch {
      return null;
    }
  }

  async function waitFor(predicate, timeoutMs, errorMessage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = predicate();
      if (result) return result;
      await sleep(80);
    }
    throw new Error(errorMessage);
  }

  async function moveCursorToElement(element) {
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    await sleep(180);
    setPlaybackCursor(point, false);
    await sleep(160);
    return point;
  }

  function collectLocalEvidence(error) {
    const bodyText = getElementText(document.body).slice(0, 240);
    return {
      consoleErrors: error ? [error.message || String(error)] : [],
      networkFailures: [],
      domNotes: [
        "Current URL: " + window.location.href,
        "Body excerpt: " + bodyText,
      ],
    };
  }

  function capturePageSnapshot() {
    return {
      url: window.location.href,
      title: document.title,
      bodyText: getElementText(document.body).slice(0, 320),
    };
  }

  function captureElementInteractionState(element) {
    if (!element || !element.isConnected) {
      return null;
    }

    return {
      text: getElementText(element).slice(0, 160),
      className: typeof element.className === "string" ? element.className : "",
      ariaSelected: element.getAttribute("aria-selected") || "",
      ariaPressed: element.getAttribute("aria-pressed") || "",
      ariaExpanded: element.getAttribute("aria-expanded") || "",
      dataState: element.getAttribute("data-state") || "",
      dataActive: element.getAttribute("data-active") || "",
      dataSelected: element.getAttribute("data-selected") || "",
    };
  }

  function didPageChange(before, after) {
    return before.url !== after.url || before.title !== after.title || before.bodyText !== after.bodyText;
  }

  function didInteractionStateChange(before, after) {
    if (!before || !after) {
      return false;
    }

    return (
      before.text !== after.text ||
      before.className !== after.className ||
      before.ariaSelected !== after.ariaSelected ||
      before.ariaPressed !== after.ariaPressed ||
      before.ariaExpanded !== after.ariaExpanded ||
      before.dataState !== after.dataState ||
      before.dataActive !== after.dataActive ||
      before.dataSelected !== after.dataSelected
    );
  }

  function inferExpectedRouteFromElement(element) {
    if (!element) return null;

    const link = element.closest("a[href]");
    if (link) {
      const href = link.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        return href;
      }
    }

    const candidates = [
      element.getAttribute("href"),
      element.getAttribute("data-href"),
      element.getAttribute("data-route"),
      element.getAttribute("data-to"),
      element.getAttribute("to"),
    ].filter(Boolean);

    return candidates[0] || null;
  }

  function urlMatchesExpectation(expectation, currentUrl) {
    if (!expectation) return false;
    if (expectation.includes("\${")) {
      const pattern = "^" + expectation.replace(/\\$\\{[^}]+\\}/g, "[^/]+").replace(/\\//g, "\\\\/") + "$";
      return new RegExp(pattern).test(new URL(currentUrl).pathname);
    }
    try {
      const expectedUrl = new URL(expectation, window.location.origin);
      return new URL(currentUrl).pathname === expectedUrl.pathname;
    } catch {
      return new RegExp(expectation).test(currentUrl);
    }
  }

  async function escalateFailureToAgent(config, evidence, reason) {
    pushLocalLog("warn", "local_runner_escalating: " + reason);
    setLocalRunStage("tracing_issue", "Local playback found a likely broken interaction. Sending the run to the agent for diagnosis.", {
      evidence,
      awaitingPatchedRetry: true,
    });
    const payload = {
      ...config,
      appUrl: window.location.origin,
      localEvidence: evidence,
      localFailureReason: reason,
    };
    await postJson("/run", payload);
    pushLocalLog("info", "local_runner_agent_started: The agent repair loop has been started with the current flow.");
  }

  async function inferExpectedRouteFromProject(config, action, element) {
    if (!config?.projectRoot) return null;

    try {
      const payload = await postJson("/infer-route", {
        projectRoot: config.projectRoot,
        target: action.target,
        label: getElementText(element),
      });
      return payload.route || null;
    } catch (error) {
      pushLocalLog(
        "warn",
        error instanceof Error ? error.message : "Could not infer a route from the target project.",
      );
      return null;
    }
  }

  async function executeLocalAction(action, index, totalActions) {
    const actionLabel = "[" + (index + 1) + "/" + totalActions + "] " + action.kind + " " + action.target;
    pushLocalLog("info", "local_runner_step: " + actionLabel);
    setLocalRunStage("observing", "Running " + actionLabel, { nextIndex: index });

    if (action.kind === "goto") {
      const nextUrl = new URL(action.target, window.location.origin).toString();
      if (nextUrl === window.location.href) {
        state.localRun.nextIndex = index + 1;
        persistOverlayState();
        return;
      }
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      window.location.assign(nextUrl);
      return "navigating";
    }

    if (action.kind === "wait_for_url") {
      await waitFor(
        () => new RegExp(action.target).test(window.location.href),
        8000,
        "Timed out waiting for URL to match " + action.target,
      );
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      return;
    }

    if (action.kind === "wait_for_text") {
      await waitFor(
        () => findByText(action.target.replace(/^text:/, "")),
        8000,
        "Timed out waiting for visible text " + action.target,
      );
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      return;
    }

    const element = await waitFor(
      () => {
        const found = resolveActionTarget(action.target);
        return found && isVisible(found) ? found : null;
      },
      8000,
      "Could not find target " + action.target,
    );

    const point = await moveCursorToElement(element);

    if (action.kind === "hover") {
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: point.x, clientY: point.y }));
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      return;
    }

    if (action.kind === "fill") {
      element.focus();
      if ("value" in element) {
        element.value = action.value || "";
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      return;
    }

    if (action.kind === "click") {
      const beforeClick = capturePageSnapshot();
      const beforeInteraction = captureElementInteractionState(element);
      const nextAction = state.localRun?.config?.browserActions?.[index + 1] || null;
      const explicitWaitForUrl = nextAction && nextAction.kind === "wait_for_url" ? nextAction.target : null;
      const domInferredRoute = explicitWaitForUrl ? null : inferExpectedRouteFromElement(element);
      const projectInferredRoute =
        explicitWaitForUrl || domInferredRoute
          ? null
          : await inferExpectedRouteFromProject(state.localRun?.config, action, element);
      const inferredRoute = domInferredRoute || projectInferredRoute;
      const expectedRoute = explicitWaitForUrl || inferredRoute;
      state.localRun.nextIndex = index + 1;
      persistOverlayState();
      setPlaybackCursor(point, true);
      await sleep(120);
      element.click();
      await sleep(420);
      setPlaybackCursor(point, false);
      let afterClick = capturePageSnapshot();
      let afterInteraction = captureElementInteractionState(element);

      if (inferredRoute) {
        pushLocalLog(
          "info",
          "local_runner_inferred_route: Expected navigation to " + inferredRoute + " from " + action.target,
        );
      }

      if (expectedRoute && !explicitWaitForUrl) {
        await waitFor(
          () => urlMatchesExpectation(expectedRoute, window.location.href),
          5000,
          "Expected navigation to " + expectedRoute + " after clicking " + action.target + ", but the route did not change.",
        );
        return;
      }

      if (!expectedRoute && (!nextAction || nextAction.kind !== "wait_for_text")) {
        await waitFor(
          () => {
            const latestPage = capturePageSnapshot();
            const latestInteraction = captureElementInteractionState(element);

            if (didPageChange(beforeClick, latestPage) || didInteractionStateChange(beforeInteraction, latestInteraction)) {
              afterClick = latestPage;
              afterInteraction = latestInteraction;
              return true;
            }

            return false;
          },
          2500,
          "Click completed but no page or interaction state change was detected for " + action.target,
        ).catch(() => null);
      }

      if (
        !didPageChange(beforeClick, afterClick) &&
        !didInteractionStateChange(beforeInteraction, afterInteraction) &&
        (!nextAction || nextAction.kind !== "wait_for_text") &&
        (!nextAction || nextAction.kind !== "wait_for_url")
      ) {
        throw new Error(
          expectedRoute
            ? "Expected navigation to " + expectedRoute + " after clicking " + action.target + ", but the route did not change."
            : "Click completed but the page did not visibly change after targeting " + action.target,
        );
      }
      return;
    }

    throw new Error("Unsupported action kind " + action.kind);
  }

  async function continueLocalRun() {
    if (!state.localRun?.active) return;
    const config = state.localRun.config;
    const actions = Array.isArray(config.browserActions) ? config.browserActions : [];

    try {
      while (state.localRun.active && state.localRun.nextIndex < actions.length) {
        const outcome = await executeLocalAction(actions[state.localRun.nextIndex], state.localRun.nextIndex, actions.length);
        if (outcome === "navigating") {
          return;
        }
      }

      setLocalRunStage("analyzing", "Primary flow completed in this tab. Summarizing the final page state.");
      await sleep(220);
      completeLocalRun("verified", "Primary flow completed in this tab and reached its expected wait conditions.", {
        evidence: collectLocalEvidence(),
      });
      pushLocalLog("info", "local_runner_verified: Same-tab playback completed successfully.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Local same-tab run failed.";
      const evidence = collectLocalEvidence(error);
      pushLocalLog("error", reason);
      await escalateFailureToAgent(config, evidence, reason).catch((agentError) => {
        pushLocalLog(
          "error",
          agentError instanceof Error ? agentError.message : "Could not start the agent repair loop after local failure.",
        );
      });
      completeLocalRun("needs_review", reason, {
        evidence,
      });
    }
  }

  async function startLocalRun(config) {
    const nextRetryCount =
      state.localRun?.awaitingPatchedRetry
        ? (state.localRun?.snapshot?.run?.retryCount ?? 1) + 1
        : 1;

    state.localRun = createRunRecord(config, "observing", "Preparing same-tab playback in the current browser.", {
      nextIndex: 0,
      retryCount: nextRetryCount,
      maxRetries: state.localRun?.snapshot?.run?.maxRetries ?? 3,
      awaitingPatchedRetry: false,
    });
    persistOverlayState();
    renderState();
    pushLocalLog("info", "local_runner_started: Executing the configured flow in the current tab.");
    await continueLocalRun();
  }

  function maybeResumeLocalRun() {
    if (!state.localRun?.active) return;
    pushLocalLog("info", "local_runner_resumed: Continuing same-tab playback after navigation.");
    window.setTimeout(() => {
      void continueLocalRun();
    }, 180);
  }

  function triggerSuccessBurst() {
    successBurst.dataset.visible = "true";
    window.setTimeout(() => {
      successBurst.dataset.visible = "false";
    }, 1650);
  }

  function buildScreenshotUrl(relativePath) {
    if (!relativePath) return "";
    const suffix = state.repairState?.timestamp ? "?ts=" + encodeURIComponent(state.repairState.timestamp) : "";
    return AGENT_BASE_URL + relativePath + suffix;
  }

  function determineEvidenceTone(items, category) {
    if (!items || items.length === 0) return "good";
    if (category === "dom") return "neutral";
    return items.length > 2 ? "bad" : "warn";
  }

  function getActionValuePlaceholder(kind) {
    if (kind === "fill") return "Text to enter into the field";
    if (kind === "wait_for_text") return "Visible text to wait for";
    if (kind === "wait_for_url") return "URL fragment to wait for";
    return "Optional for this step";
  }

  function buildAvailableTargets() {
    const seen = new Set();
    const items = [];
    const candidates = Array.from(
      document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [aria-label], [title]"),
    )
      .filter((element) => !root.contains(element) && !toggle.contains(element))
      .slice(0, 32);

    for (const element of candidates) {
      const descriptor = getTargetDescriptor(element);
      if (!descriptor || seen.has(descriptor)) continue;
      seen.add(descriptor);
      const text = (element.innerText || element.textContent || element.getAttribute("placeholder") || descriptor).trim();
      items.push({
        descriptor,
        label: (text || descriptor).slice(0, 90),
      });
    }

    state.availableTargets = items;
  }

  function renderActionBuilder() {
    const kind = els.actionKind.value || "click";
    els.actionValue.placeholder = getActionValuePlaceholder(kind);
    els.actionTarget.innerHTML = state.availableTargets.length
      ? state.availableTargets.map((item) => \`<option value="\${escapeHtml(item.descriptor)}">\${escapeHtml(item.label)} -> \${escapeHtml(item.descriptor)}</option>\`).join("")
      : "<option value=''>No scanned targets yet</option>";
  }

  function summarizeValidation(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, message: "Config must be a JSON object." };
    }

    if (typeof parsed.goal !== "string" || !parsed.goal.trim()) {
      return { ok: false, message: "Config is missing a non-empty \\"goal\\" field." };
    }

    if (!Array.isArray(parsed.browserActions) || parsed.browserActions.length === 0) {
      return { ok: false, message: "Config must include at least one browser action." };
    }

    const invalidAction = parsed.browserActions.find((action) => {
      return !action || typeof action !== "object" || typeof action.kind !== "string" || typeof action.target !== "string";
    });

    if (invalidAction) {
      return { ok: false, message: "Every browser action must include string \\"kind\\" and \\"target\\" fields." };
    }

    if (!Array.isArray(parsed.regressionChecks)) {
      return { ok: false, message: "Regression checks must be an array, even if empty." };
    }

    if (typeof parsed.llmProvider !== "string" || !parsed.llmProvider.trim()) {
      return { ok: false, message: "Config is missing a non-empty \\"llmProvider\\" field." };
    }

    if (typeof parsed.model !== "string" || !parsed.model.trim()) {
      return { ok: false, message: "Config is missing a non-empty \\"model\\" field." };
    }

    return {
      ok: true,
      message:
        "Config looks ready to run. " +
        parsed.browserActions.length +
        " browser action" +
        (parsed.browserActions.length === 1 ? "" : "s") +
        " and " +
        parsed.regressionChecks.length +
        " regression check" +
        (parsed.regressionChecks.length === 1 ? "" : "s") +
        " detected.",
    };
  }

  function validateConfigEditor() {
    try {
      const parsed = JSON.parse(els.config.value || "{}");
      syncLlmControlsFromConfig(parsed);
      state.configValidation = summarizeValidation(parsed);
    } catch (error) {
      state.configValidation = {
        ok: false,
        message: "Config JSON is invalid: " + (error && error.message ? error.message : "Unknown parse error."),
      };
    }

    els.config.dataset.invalid = state.configValidation.ok ? "false" : "true";
    els.configValidation.dataset.tone = state.configValidation.ok ? "good" : "bad";
    els.configValidation.textContent = state.configValidation.message;
    els.runButton.disabled = !state.configValidation.ok;
    return state.configValidation.ok;
  }

  function pushTimelineEntry(entry) {
    const last = state.timeline[state.timeline.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      last.title === entry.title &&
      last.detail === entry.detail
    ) {
      return;
    }

    state.timeline.push(entry);
    state.timeline = state.timeline.slice(-14);
  }

  function renderTimeline() {
    els.timeline.innerHTML = state.timeline.length
      ? state.timeline.slice().reverse().map((entry) => \`
          <div class="reform-timeline-item">
            <div class="reform-timeline-time">\${escapeHtml(formatTime(entry.timestamp) || "--:--:--")}</div>
            <div>
              <div class="reform-timeline-title">\${escapeHtml(entry.title)}</div>
              <div class="reform-timeline-detail">\${escapeHtml(entry.detail || "")}</div>
            </div>
          </div>
        \`).join("")
      : "<div class=\\"reform-empty\\">No timeline entries yet. Start a run to see stage transitions and major decisions appear here.</div>";
  }

  function renderScreenshots() {
    const screenshots = state.repairState?.screenshots || { beforePath: "", afterPath: "" };
    const shots = [
      {
        title: "Before Repair",
        detail: "Baseline capture before any edit is applied.",
        path: screenshots.beforePath,
      },
      {
        title: "After Repair",
        detail: "Use this to confirm UI-level improvements after replay.",
        path: screenshots.afterPath,
      },
    ];

    els.shotGrid.innerHTML = shots.map((shot) => {
      const imageUrl = buildScreenshotUrl(shot.path);
      return \`
        <div class="reform-shot">
          <div class="reform-shot-head">
            <strong>\${escapeHtml(shot.title)}</strong>
            <div class="reform-badge" data-tone="\${shot.path ? "good" : "neutral"}">\${shot.path ? "Captured" : "Pending"}</div>
          </div>
          \${imageUrl
            ? '<img alt="' + escapeHtml(shot.title) + '" src="' + escapeHtml(imageUrl) + '" />'
            : '<div class="reform-shot-empty">' + escapeHtml(shot.detail) + "</div>"}
        </div>
      \`;
    }).join("");
  }

  function renderEvidence() {
    const evidence = state.repairState?.evidence || { consoleErrors: [], networkFailures: [], domNotes: [] };
    const sections = [
      {
        title: "Console Errors",
        items: evidence.consoleErrors,
        tone: determineEvidenceTone(evidence.consoleErrors, "console"),
      },
      {
        title: "Network Failures",
        items: evidence.networkFailures,
        tone: determineEvidenceTone(evidence.networkFailures, "network"),
      },
      {
        title: "DOM Notes",
        items: evidence.domNotes,
        tone: determineEvidenceTone(evidence.domNotes, "dom"),
      },
    ];

    els.evidenceGrid.innerHTML = sections.map((section) => \`
      <div class="reform-evidence-card" data-tone="\${section.tone}">
        <div class="reform-evidence-head">
          <strong>\${escapeHtml(section.title)}</strong>
          <div class="reform-badge" data-tone="\${section.tone}">\${section.items.length}</div>
        </div>
        \${section.items.length
          ? '<div class="reform-evidence-list">' + section.items.slice(0, 5).map((item) => '<div class="reform-evidence-item">' + escapeHtml(item) + "</div>").join("") + "</div>"
          : '<div class="reform-shot-empty">No items captured for this category.</div>'}
      </div>
    \`).join("");
  }

  function getStatusTone() {
    if (state.socketState !== "open") return "bad";
    if (state.repairState?.stage === "verified") return "good";
    if (state.repairState?.stage === "needs_review") return "bad";
    if (state.repairState?.stage === "awaiting_approval" || state.pendingPatch) return "warn";
    return "neutral";
  }

  function applyEditModeVisuals(enabled) {
    root.classList.toggle("reform-edit-mode-active", enabled);
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    root.classList.toggle("reform-collapsed", collapsed);
    applyEditModeVisuals(state.editModeEnabled);
    toggle.dataset.open = collapsed ? "false" : "true";
    toggle.textContent = "Reform";
    updateApprovalPopoutPosition();
    persistOverlayState();
  }

  function updateOverlayWidth() {
    const minWidth = 460;
    const maxWidth = Math.max(minWidth, window.innerWidth - 24);
    const shell = root.querySelector(".reform-shell");
    if (!shell || state.collapsed || window.innerWidth <= 640) {
      root.style.width = "";
      return;
    }

    const desiredWidth = Math.min(maxWidth, Math.max(minWidth, shell.scrollWidth + 2));
    root.style.width = desiredWidth + "px";
  }

  function updateApprovalPopoutPosition() {
    if (window.innerWidth <= 640) {
      approvalPopout.style.right = "";
      return;
    }

    const overlayWidth = state.collapsed ? 0 : Math.max(460, Math.round(root.getBoundingClientRect().width || 460));
    approvalPopout.style.right = (overlayWidth + 36) + "px";
  }

  function applyHighlight(selector) {
    if (state.selectedElement) {
      state.selectedElement.classList.remove("reform-highlight");
      state.selectedElement = null;
    }
    if (!selector) return;
    const element = document.querySelector(selector);
    if (element) {
      element.classList.add("reform-highlight");
      state.selectedElement = element;
    }
  }

  function getTargetDescriptor(element) {
    if (!element) return null;

    const label = element.labels && element.labels[0] ? element.labels[0].textContent.trim() : "";
    if (label) {
      return "label:" + label;
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      if (element.tagName === "A") {
        return "role:link:" + ariaLabel.trim();
      }

      if (element.tagName === "BUTTON") {
        return "role:button:" + ariaLabel.trim();
      }

      return '[aria-label="' + ariaLabel.trim() + '"]';
    }

    const title = element.getAttribute("title");
    if (title) {
      if (element.tagName === "A") {
        return "role:link:" + title.trim();
      }

      if (element.tagName === "BUTTON") {
        return "role:button:" + title.trim();
      }
    }

    const role = element.getAttribute("role");
    const text = (element.innerText || element.textContent || "").trim();
    if (role && text) {
      return "role:" + role + ":" + text;
    }

    if (element.tagName === "A") {
      if (text) {
        return "role:link:" + text;
      }

      const href = element.getAttribute("href");
      if (href) {
        return 'a[href="' + href + '"]';
      }
    }

    if (element.tagName === "BUTTON" && text) {
      return "role:button:" + text;
    }

    if (element.id) {
      return "#" + element.id;
    }

    if (element.name) {
      return '[name="' + element.name + '"]';
    }

    if (element.dataset && element.dataset.repairId) {
      return '[data-repair-id="' + element.dataset.repairId + '"]';
    }

    const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 2);
    if (classes.length > 0) {
      return element.tagName.toLowerCase() + "." + classes.join(".");
    }

    return null;
  }

  function removeRecordedAction(index) {
    state.recordedActions.splice(index, 1);
    renderRecorder();
    syncRecordedActionsIntoConfig();
    persistOverlayState();
  }

  function moveRecordedAction(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.recordedActions.length) return;
    const item = state.recordedActions[index];
    state.recordedActions[index] = state.recordedActions[nextIndex];
    state.recordedActions[nextIndex] = item;
    renderRecorder();
    syncRecordedActionsIntoConfig();
    persistOverlayState();
  }

  function renderRecorder() {
    els.recordButton.textContent = state.recorderEnabled ? "Stop Recording" : "Start Recording";
    els.recordButton.dataset.active = state.recorderEnabled ? "true" : "false";
    els.recordButton.style.background = state.recorderEnabled
      ? "linear-gradient(135deg, rgba(255, 180, 122, 0.92), rgba(255, 125, 125, 0.92))"
      : "";
    els.recorderList.innerHTML = state.recordedActions.length
      ? state.recordedActions.map((action, index) => \`
          <div class="reform-recorder-item">
            <div class="reform-recorder-row">
              <div>
                <strong>\${index + 1}. \${action.kind}</strong>
                <div>\${action.target}</div>
                \${action.value ? "<div>" + action.value + "</div>" : ""}
              </div>
              <div class="reform-mini-actions">
                <button class="reform-mini-button" data-action="up" data-index="\${index}">↑</button>
                <button class="reform-mini-button" data-action="down" data-index="\${index}">↓</button>
                <button class="reform-mini-button" data-action="remove" data-index="\${index}">Remove</button>
              </div>
            </div>
          </div>
        \`).join("")
      : "<div class=\\"reform-empty\\">No recorded steps yet. Turn on recording and interact with the page, or use page scanning to seed a flow.</div>";
  }

  function buildElementDescriptor(element) {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const attributes = {};
    for (const attr of Array.from(element.attributes || [])) {
      if (!attr || !attr.name) continue;
      if (attr.name === "class" || attr.name === "style") continue;
      if (!attr.name.startsWith("data-") && attr.name !== "aria-label" && attr.name !== "title") continue;
      attributes[attr.name] = attr.value;
    }

    const textContent = (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180);
    return {
      tagName: element.tagName,
      id: element.id || null,
      className: Array.from(element.classList || []).join(" "),
      textContent,
      attributes,
      boundingBox: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      },
      componentName: null,
      parentComponentNames: [],
      cssSelector: getTargetDescriptor(element),
      occurrenceCount: 1,
    };
  }

  function isTestableActionElement(element) {
    if (!element || root.contains(element) || toggle.contains(element)) return false;
    if (!(element instanceof HTMLElement)) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!element.isConnected) return false;

    const tagName = element.tagName.toLowerCase();
    if (tagName === "button") return true;
    if (tagName === "a" && element.hasAttribute("href")) return true;
    if (element.getAttribute("role") === "button") return true;
    if (element.hasAttribute("onclick")) return true;
    if (element.dataset && element.dataset.repairId) return true;
    return false;
  }

  function getNormalizedFlowLabel(text) {
    return String(text || "")
      .replace(/\\s+/g, " ")
      .replace(/[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF]/gu, "")
      .trim()
      .toLowerCase();
  }

  function isLikelyActionLabel(text) {
    const label = getNormalizedFlowLabel(text);
    if (!label) return false;

    const actionPatterns = [
      /\\badd\\b/,
      /\\bremove\\b/,
      /\\bbuy\\b/,
      /\\bcheckout\\b/,
      /\\bsubmit\\b/,
      /\\bsave\\b/,
      /\\bcontinue\\b/,
      /\\bnext\\b/,
      /\\bback\\b/,
      /\\bconfirm\\b/,
      /\\bcancel\\b/,
      /\\bedit\\b/,
      /\\bdelete\\b/,
      /\\bupdate\\b/,
      /\\bsearch\\b/,
      /\\bfilter\\b/,
      /\\bsort\\b/,
      /\\bopen\\b/,
      /\\bclose\\b/,
      /\\bview\\b/,
      /\\blog in\\b/,
      /\\blog out\\b/,
      /\\bsign in\\b/,
      /\\bsign up\\b/,
      /\\bcreate\\b/,
      /\\bapply\\b/,
      /\\bsend\\b/,
      /\\bdownload\\b/,
      /\\bupload\\b/,
      /\\bretry\\b/,
      /\\bstart\\b/,
      /\\bstop\\b/,
      /\\bplay\\b/,
      /\\bpause\\b/,
      /\\bexpand\\b/,
      /\\bcollapse\\b/,
      /\\badd to cart\\b/,
      /\\bgo to cart\\b/,
    ];

    return actionPatterns.some((pattern) => pattern.test(label));
  }

  function isLikelyRepresentativeAction(element, label) {
    const normalized = getNormalizedFlowLabel(label);
    if (!normalized) return false;

    const tagName = element.tagName.toLowerCase();
    const hasActionRole =
      tagName === "button" ||
      (tagName === "a" && element.hasAttribute("href")) ||
      element.getAttribute("role") === "button" ||
      element.hasAttribute("onclick") ||
      element.dataset?.repairId;

    if (!hasActionRole) {
      return false;
    }

    if (isLikelyActionLabel(normalized)) {
      return true;
    }

    const shortNavLabels = ["cart", "checkout", "menu", "back", "next", "continue", "more"];
    if (tagName === "a" && shortNavLabels.includes(normalized)) {
      return true;
    }

    return false;
  }

  function extractFunctionCandidates(content) {
    if (!content) return [];

    const names = new Map();
    const patterns = [
      /(?:^|\\n)\\s*(?:export\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(/g,
      /(?:^|\\n)\\s*(?:export\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:function\\s*\\(|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)/g,
      /(?:^|\\n)\\s*(?:export\\s+)?class\\s+([A-Za-z_$][\\w$]*)\\b/g,
    ];

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        if (!match[1]) continue;
        const name = match[1];
        const lower = name.toLowerCase();
        let score = 0;
        if (/^(handle|on|toggle|open|close|submit|click|save|add|remove|select|change|update|load|fetch|validate|set|get|render|submit)/.test(lower)) score += 8;
        if (/(button|form|input|menu|dialog|modal|nav|tab|page|route)/.test(lower)) score += 3;
        if (name[0] === name[0]?.toUpperCase()) score -= 2;
        const existing = names.get(name);
        if (!existing || score > existing.score) {
          names.set(name, { name, score });
        }
      }
    }

    return Array.from(names.values())
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((item) => item.name);
  }

  function deriveFlowSteps(actionLabel, filePath, lineNumber, functions, confidence) {
    const primaryFunction = functions[0] || "the related handler";
    const secondaryFunction = functions[1] || "the surrounding render path";
    return [
      {
        title: "Trigger the entry button",
        copy: actionLabel + " is the visible entry point on this page and starts the interaction.",
      },
      {
        title: "Trace the source file",
        copy: filePath + (lineNumber ? ":" + lineNumber : "") + " is the resolved source location for this action.",
      },
      {
        title: "Exercise the testable code",
        copy: "Focus on " + primaryFunction + (secondaryFunction ? " and " + secondaryFunction : "") + " while validating the path.",
      },
      {
        title: "Confirm the outcome",
        copy: confidence && confidence >= 0.9
          ? "High-confidence mapping. Verify the expected UI or route change after the button action."
          : "Review the visible result and any related state change to confirm the flow is stable.",
      },
    ];
  }

  function getProjectRootForScanning() {
    const healthRoot = state.health?.config?.projectRoot;
    if (healthRoot) return healthRoot;

    const repairRoot = state.repairState?.config?.projectRoot;
    if (repairRoot) return repairRoot;

    try {
      const parsed = JSON.parse(els.config.value || "{}");
      if (typeof parsed.projectRoot === "string" && parsed.projectRoot.trim()) {
        return parsed.projectRoot.trim();
      }
    } catch {
      // Ignore malformed config during bootstrap.
    }

    return "";
  }

  async function resolveButtonFlowSuggestion(element, index) {
    const descriptor = buildElementDescriptor(element);
    if (!descriptor) return null;

    const label = (element.innerText || element.textContent || descriptor.cssSelector || "Button").trim().replace(/\\s+/g, " ").slice(0, 120) || "Button";
    const payload = {
      element: descriptor,
      projectRoot: getProjectRootForScanning(),
      currentUrl: window.location.href,
    };

    if (!payload.projectRoot) return null;

    const response = await postJson("/inspect/resolve-element", payload);
    if (!response?.result) return null;

    const filePath = response.result.filePath || "Unknown file";
    const lineNumber = response.result.lineNumber ?? null;
    const functions = extractFunctionCandidates(response.result.content).slice(0, 5);
    const actionTarget = descriptor.cssSelector || getTargetDescriptor(element);
    const title = functions[0] ? label + " via " + functions[0] : label;
    const steps = deriveFlowSteps(label, filePath, lineNumber, functions, response.result.confidence);

    return {
      title,
      description: "Code-backed flow resolved from the current page button.",
      actionTarget,
      sourceFile: filePath,
      lineNumber,
      confidence: response.result.confidence ?? null,
      functions,
      steps,
      actions: [
        { kind: "goto", target: getCurrentRouteTarget() },
        { kind: "hover", target: actionTarget },
        { kind: "click", target: actionTarget },
      ],
    };
  }

  function renderSuggestions() {
    if (state.testSuggestionsLoading) {
      els.suggestionList.innerHTML = \`
        <div class="reform-scan-loading">
          <strong>Scanning page buttons</strong>
          <div>\${escapeHtml(state.testSuggestionsMessage || "Resolving the selected button to source code and testable functions.")}</div>
        </div>
      \`;
      return;
    }

    els.suggestionList.innerHTML = state.testSuggestions.length
      ? state.testSuggestions.map((suggestion, index) => \`
          <div class="reform-flow-card">
            <div class="reform-flow-head">
              <div>
                <div class="reform-flow-title">\${escapeHtml(suggestion.title)}</div>
                <div class="reform-flow-subtitle">\${escapeHtml(suggestion.description)}</div>
                \${suggestion.occurrenceCount > 1 ? '<div class="reform-flow-subtitle">Representative of ' + String(suggestion.occurrenceCount) + ' matching elements on the page.</div>' : ""}
              </div>
              <div class="reform-flow-file">
                <div class="reform-flow-meta">
                  \${suggestion.occurrenceCount > 1 ? '<div class="reform-badge" data-tone="neutral">Representative x' + String(suggestion.occurrenceCount) + '</div>' : ""}
                  <div class="reform-badge" data-tone="\${suggestion.confidence >= 0.9 ? "good" : suggestion.confidence >= 0.7 ? "warn" : "neutral"}">\${suggestion.confidence ? Math.round(suggestion.confidence * 100) + "%" : "resolved"}</div>
                </div>
                <div>\${escapeHtml(suggestion.sourceFile)}\${suggestion.lineNumber ? ":" + suggestion.lineNumber : ""}</div>
              </div>
            </div>
            <div class="reform-flow-steps">
              \${suggestion.steps.map((step, stepIndex) => \`
                <div class="reform-flow-step">
                  <div class="reform-flow-step-index">\${stepIndex + 1}</div>
                  <div>
                    <div class="reform-flow-step-title">\${escapeHtml(step.title)}</div>
                    <div class="reform-flow-step-copy">\${escapeHtml(step.copy)}</div>
                  </div>
                </div>
              \`).join("")}
            </div>
            <div class="reform-flow-fns">
              \${(suggestion.functions.length ? suggestion.functions : ["No obvious handler names found"]).map((fn) => \`<span class="reform-flow-pill">\${escapeHtml(fn)}</span>\`).join("")}
            </div>
            <div class="reform-flow-action">
              <button class="reform-mini-button" data-suggestion-index="\${index}">Use flow</button>
            </div>
          </div>
        \`).join("")
      : \`
          <div class="reform-suggestion-empty">
            <strong>No code-backed button flow found yet.</strong>
            <div>\${escapeHtml(state.testSuggestionsMessage || "Scan the page to resolve a visible button into its related source file and testable functions.")}</div>
          </div>
        \`;
  }

  function getCurrentRouteTarget() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function shouldResetRegressionChecks(regressionChecks, startTarget) {
    if (!Array.isArray(regressionChecks) || regressionChecks.length === 0) {
      return true;
    }

    if (regressionChecks.length !== 1) {
      return false;
    }

    const [onlyCheck] = regressionChecks;
    return Boolean(
      onlyCheck &&
      typeof onlyCheck === "object" &&
      typeof onlyCheck.path === "string" &&
      !onlyCheck.expectText &&
      (onlyCheck.path === "/" || onlyCheck.path === startTarget),
    );
  }

  function syncRecordedActionsIntoConfig() {
    if (!state.health) {
      return;
    }

    try {
      const currentConfig = JSON.parse(els.config.value || "{}");
      const startTarget = getCurrentRouteTarget();
      currentConfig.appUrl = window.location.origin;
      currentConfig.browserActions =
        state.recordedActions.length > 0
          ? [{ kind: "goto", target: startTarget }, ...state.recordedActions]
          : [{ kind: "goto", target: startTarget }];
      if (shouldResetRegressionChecks(currentConfig.regressionChecks, startTarget)) {
        currentConfig.regressionChecks = [{ path: startTarget }];
      }
      els.config.value = JSON.stringify(currentConfig, null, 2);
      state.configText = els.config.value;
      validateConfigEditor();
      persistOverlayState();
    } catch {
      // Keep recorder independent from malformed config.
    }
  }

  function pushRecordedAction(action) {
    const previous = state.recordedActions[state.recordedActions.length - 1];
    if (
      previous &&
      previous.kind === action.kind &&
      previous.target === action.target &&
      previous.value === action.value
    ) {
      return;
    }

    state.recordedActions.push(action);
    renderRecorder();
    syncRecordedActionsIntoConfig();
    persistOverlayState();
  }

  function addActionFromBuilder() {
    const kind = els.actionKind.value;
    const selectedTarget = els.actionTarget.value;
    const rawValue = els.actionValue.value.trim();
    let target = selectedTarget;
    let value;

    if (kind === "wait_for_text") {
      target = rawValue ? "text:" + rawValue : selectedTarget;
    } else if (kind === "wait_for_url") {
      target = rawValue || selectedTarget;
    } else if (kind === "fill") {
      value = rawValue;
    }

    if (!target) {
      return;
    }

    if ((kind === "fill" || kind === "wait_for_text" || kind === "wait_for_url") && !rawValue) {
      return;
    }

    pushRecordedAction({
      kind,
      target,
      value,
    });

    els.actionValue.value = "";
  }

  function buildLegacySuggestions() {
    const suggestions = [];
    const seen = new Set();
    const startTarget = getCurrentRouteTarget();
    const clickable = Array.from(
      document.querySelectorAll("button, a[href], [role='button'], [onclick], [data-repair-id]"),
    )
      .filter((element) => !root.contains(element) && !toggle.contains(element))
      .slice(0, 16);

    for (const element of clickable) {
      const descriptor = getTargetDescriptor(element);
      if (!descriptor) continue;
      if (seen.has(descriptor)) continue;
      seen.add(descriptor);

      const label = (element.innerText || element.textContent || descriptor).trim().slice(0, 120);
      if (!isLikelyRepresentativeAction(element, label) && !element.closest("form")) {
        continue;
      }
      const href = element.getAttribute("href");
      const suggestion = {
        title: label || descriptor,
        description: href
          ? "Navigate and verify route for this clickable element."
          : "Hover and click this interactive element.",
        actions: [
          { kind: "goto", target: startTarget },
          { kind: "hover", target: descriptor },
          { kind: "click", target: descriptor },
          ...(href ? [{ kind: "wait_for_url", target: href }] : []),
        ],
        sourceFile: "Current page",
        lineNumber: null,
        confidence: null,
        functions: [],
        steps: [
          { title: "Inspect the element", copy: "Use the highlighted control on the page." },
          { title: "Trigger the interaction", copy: "Click the visible control and confirm the route or state change." },
          { title: "Validate the result", copy: "Make sure the page ends in the expected state." },
        ],
        occurrenceCount: 1,
      };

      suggestions.push(suggestion);
    }

    const forms = Array.from(document.querySelectorAll("form")).slice(0, 6);
    for (const form of forms) {
      const inputs = Array.from(form.querySelectorAll("input, textarea")).slice(0, 4);
      const submit = form.querySelector("button, [type='submit']");
      const submitDescriptor = getTargetDescriptor(submit);
      if (!submitDescriptor) continue;

      const actions = [{ kind: "goto", target: startTarget }];
      for (const input of inputs) {
        const descriptor = getTargetDescriptor(input);
        if (!descriptor) continue;
        actions.push({
          kind: "fill",
          target: descriptor,
          value: input.getAttribute("placeholder") || input.getAttribute("name") || "demo",
        });
      }
      actions.push({ kind: "click", target: submitDescriptor });

      suggestions.push({
        title: "Form submit: " + ((submit.innerText || submit.textContent || "submit").trim()),
        description: "Fill visible fields and submit the form.",
        actions,
        sourceFile: "Current page",
        lineNumber: null,
        confidence: null,
        functions: [],
        steps: [
          { title: "Fill the form", copy: "Populate the visible fields with demo input." },
          { title: "Submit the form", copy: "Trigger the submit control on the page." },
          { title: "Verify the outcome", copy: "Confirm the navigation, message, or state update." },
        ],
        occurrenceCount: 1,
      });
    }

    return suggestions;
  }

  async function buildSuggestedTests() {
    const scanId = ++suggestionScanSerial;
    state.testSuggestionsLoading = true;
    state.testSuggestionsMessage = "Resolving action buttons to source files and testable functions.";
    state.testSuggestions = [];
    renderSuggestions();

    buildAvailableTargets();
    const rawCandidates = Array.from(
      document.querySelectorAll("button, a[href], [role='button'], [onclick], [data-repair-id]"),
    )
      .filter(isTestableActionElement)
      .slice(0, 8);

    const labelCounts = new Map();
    for (const element of rawCandidates) {
      const label = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim();
      if (!isLikelyRepresentativeAction(element, label)) {
        continue;
      }
      const key = getNormalizedFlowLabel(label);
      if (!key) continue;
      labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
    }

    const seenLabels = new Set();
    const buttons = rawCandidates.filter((element) => {
      const label = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim();
      if (!isLikelyRepresentativeAction(element, label)) {
        return false;
      }
      const key = getNormalizedFlowLabel(label);
      if (!key || seenLabels.has(key)) {
        return false;
      }
      seenLabels.add(key);
      return true;
    });

    const suggestions = [];
    for (const [index, element] of buttons.entries()) {
      try {
        const label = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim();
        const count = labelCounts.get(getNormalizedFlowLabel(label)) || 1;
        const suggestion = await resolveButtonFlowSuggestion(element, index);
        if (scanId !== suggestionScanSerial) return;
        if (suggestion) {
          suggestion.occurrenceCount = count;
          suggestions.push(suggestion);
        }
      } catch {
        // Fall back to legacy suggestions when resolution fails.
      }
    }

    if (scanId !== suggestionScanSerial) return;

    if (suggestions.length === 0) {
      suggestions.push(...buildLegacySuggestions());
      state.testSuggestionsMessage = suggestions.length
        ? "Could not resolve code-backed button flows on this page, so showing interactive fallbacks."
        : "No actionable buttons or forms were found on this page.";
    } else {
      state.testSuggestionsMessage = "Resolved " + suggestions.length + " button flow" + (suggestions.length === 1 ? "" : "s") + " from the current page.";
    }

    state.testSuggestions = suggestions;
    state.testSuggestionsLoading = false;
    renderSuggestions();
    renderActionBuilder();
  }

  function useSuggestedTest(index) {
    const suggestion = state.testSuggestions[index];
    if (!suggestion) return;
    const startTarget = getCurrentRouteTarget();
    state.recordedActions = suggestion.actions
      .filter((action) => action.kind !== "goto" || action.target !== startTarget)
      .map((action) => ({ ...action }));
    renderRecorder();
    syncRecordedActionsIntoConfig();
    persistOverlayState();
  }

  function handleRecordingClick(event) {
    if (!state.recorderEnabled) return;
    if (root.contains(event.target) || toggle.contains(event.target)) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    const descriptor = getTargetDescriptor(target);
    if (!descriptor) return;

    pushRecordedAction({ kind: "click", target: descriptor });
  }

  function handleRecordingInput(event) {
    if (!state.recorderEnabled) return;
    if (root.contains(event.target) || toggle.contains(event.target)) return;

    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      ? event.target
      : null;

    if (!target) return;

    const descriptor = getTargetDescriptor(target);
    if (!descriptor) return;

    state.recordingInputTarget = descriptor;
  }

  function handleRecordingChange(event) {
    if (!state.recorderEnabled) return;
    if (root.contains(event.target) || toggle.contains(event.target)) return;

    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      ? event.target
      : null;

    if (!target) return;

    const descriptor = getTargetDescriptor(target);
    if (!descriptor) return;

    pushRecordedAction({
      kind: "fill",
      target: descriptor,
      value: target.value,
    });
  }

  function renderLogs() {
    els.logList.innerHTML = state.logs.slice(-12).map((entry) => \`
      <div class="reform-log">
        <div class="reform-log-head">
          <div class="reform-log-level">\${escapeHtml(entry.level)}</div>
          <div class="reform-log-time">\${escapeHtml(formatTime(entry.timestamp))}</div>
        </div>
        <div>\${escapeHtml(entry.message)}</div>
      </div>
    \`).join("") || "<div class=\\"reform-empty\\">No live logs yet. Once the agent starts emitting events, the newest messages will appear here.</div>";
  }

  function renderRegressions() {
    const regressions = state.repairState?.regressions || [];
    els.regressions.innerHTML = regressions.length
      ? regressions.map((entry) => \`
          <div class="reform-regression">
            <div class="reform-regression-head">
              <strong>\${escapeHtml(entry.path)}</strong>
              <div class="reform-badge" data-tone="\${entry.passed ? "good" : "bad"}">\${entry.passed ? "Passed" : "Failed"}</div>
            </div>
            <div>\${escapeHtml(entry.detail)}</div>
          </div>
        \`).join("")
      : "<div class=\\"reform-empty\\">No regression checks yet. They appear after a healthy primary flow or after a patch has been retested.</div>";
  }

  function renderPendingPatch() {
    const activeStage = state.repairState?.stage;
    const showLoadingApproval =
      !state.pendingPatch &&
      (activeStage === "tracing_issue" || activeStage === "proposing_patch" || activeStage === "awaiting_approval");

    if (!state.pendingPatch && !showLoadingApproval) {
      els.approvalSection.style.display = "none";
      approvalPopout.dataset.visible = "false";
      els.popoutSummary.textContent = "No pending patch.";
      els.popoutDiffList.innerHTML = "";
      return;
    }

    if (showLoadingApproval) {
      els.approvalSection.style.display = "";
      approvalPopout.dataset.visible = "true";
      els.patchRationale.textContent = "Preparing review package from the latest evidence.";
      els.popoutSummary.textContent = "Preparing review package from the latest evidence.";
      els.approveButton.disabled = true;
      els.rejectButton.disabled = true;
      els.popoutApproveButton.disabled = true;
      els.popoutRejectButton.disabled = true;
      els.diffList.innerHTML = \`
        <div class="reform-loading-card">
          <div class="reform-skeleton reform-skeleton-line" data-width="full"></div>
          <div class="reform-skeleton reform-skeleton-line" data-width="wide"></div>
          <div class="reform-skeleton reform-skeleton-diff"></div>
        </div>
      \`;
      els.popoutDiffList.innerHTML = \`
        <div class="reform-loading-card">
          <div class="reform-skeleton reform-skeleton-line" data-width="mid"></div>
          <div class="reform-skeleton reform-skeleton-diff"></div>
        </div>
      \`;
      return;
    }

    els.approvalSection.style.display = "";
    approvalPopout.dataset.visible = "true";
    els.approveButton.disabled = false;
    els.rejectButton.disabled = false;
    els.popoutApproveButton.disabled = false;
    els.popoutRejectButton.disabled = false;
    els.patchRationale.textContent = state.pendingPatch.rationale + " Confidence: " + state.pendingPatch.confidence;
    els.popoutSummary.textContent = state.pendingPatch.rationale + " Confidence: " + state.pendingPatch.confidence;
    els.diffList.innerHTML = state.pendingPatch.edits.map((edit) => \`
      <div class="reform-diff">
        <strong>\${escapeHtml(edit.filePath)}</strong>
        <div>\${escapeHtml(edit.reason)}</div>
        <pre>\${escapeHtml(edit.diff)}</pre>
      </div>
    \`).join("");
    els.popoutDiffList.innerHTML = state.pendingPatch.edits.map((edit) => \`
      <div class="reform-diff">
        <strong>\${escapeHtml(edit.filePath)}</strong>
        <div>\${escapeHtml(edit.reason)}</div>
      </div>
    \`).join("");
    updateApprovalPopoutPosition();
  }

  function renderState() {
    const repairState = state.localRun?.active ? state.localRun.snapshot : state.repairState;
    const socketLabel = state.socketState === "open" ? "Connected" : prettifyStage(state.socketState);
    const activeProvider = getActiveProvider(repairState);
    const activeModel = getActiveModel(repairState);
    els.status.textContent = socketLabel;
    els.status.dataset.tone = getStatusTone();
    els.modelBadge.textContent = "LLM: " + prettifyProvider(activeProvider);
    els.modelValue.textContent = prettifyProvider(activeProvider) + " / " + activeModel;

    if (repairState) {
      const copy = stageCopy[repairState.stage] || {
        title: prettifyStage(repairState.stage),
        detail: repairState.detail || "The agent reported a new stage.",
        next: "Watch the logs for more detail.",
        tone: "neutral",
      };

      els.summaryTitle.textContent = copy.title;
      els.summaryDetail.textContent = copy.detail;
      els.stageBadge.textContent = prettifyStage(repairState.stage);
      els.stageBadge.dataset.tone = copy.tone;
      els.goalValue.textContent = repairState.run.goal || "Not available";
      els.stageValue.textContent = prettifyStage(repairState.stage);
      els.approvalValue.textContent = state.pendingPatch || state.repairState?.stage === "tracing_issue" || state.repairState?.stage === "proposing_patch" || state.repairState?.stage === "awaiting_approval" ? "Review in progress" : "No pending decisions";
      els.nextStep.textContent = copy.next;
      const primaryFlow = repairState.primaryFlow;
      const flowMeta = primaryFlow
        ? [
            "<div><strong>Primary flow:</strong> " + escapeHtml(primaryFlow.label) + "</div>",
            "<div><strong>Flow steps:</strong> " + String(primaryFlow.browserActions.length) + " actions</div>",
            "<div><strong>Replay start:</strong> " + escapeHtml(primaryFlow.startUrl) + "</div>",
            primaryFlow.failingAction
              ? "<div><strong>Last failed step:</strong> " + escapeHtml(primaryFlow.failingAction.kind + " " + primaryFlow.failingAction.target) + "</div>"
              : "<div><strong>Replay status:</strong> Ready to rerun the same flow after approval.</div>",
          ]
        : [];
      els.guidance.textContent = repairState.detail || copy.detail;
      els.runMeta.innerHTML = [
        "<div><strong>Summary:</strong> " + escapeHtml(repairState.run.summary || repairState.detail || "No summary available.") + "</div>",
        "<div><strong>Last update:</strong> " + escapeHtml(formatTime(repairState.timestamp) || "Unknown") + "</div>",
        ...flowMeta,
      ].join("");
      applyHighlight(repairState.run.targetSelector);
    } else {
      els.summaryTitle.textContent = "Waiting for agent state";
      els.summaryDetail.textContent = "The overlay is connected, but no repair snapshot has arrived yet.";
      els.stageBadge.textContent = "Idle";
      els.stageBadge.dataset.tone = "neutral";
      els.goalValue.textContent = "Not available";
      els.stageValue.textContent = "Not available";
      els.guidance.textContent = "Waiting for the first run update.";
      els.approvalValue.textContent = state.pendingPatch ? "Decision required" : "No pending decisions";
      els.nextStep.textContent = "Start a repair run or wait for the local agent to publish its first update.";
      els.runMeta.innerHTML = "<div><strong>Connection:</strong> " + escapeHtml(socketLabel) + "</div>";
    }

    renderPendingPatch();
    renderLogs();
    renderRegressions();
    renderTimeline();
    renderScreenshots();
    renderEvidence();
    renderActionBuilder();
    renderRecorder();
    renderSuggestions();
    updateOverlayWidth();
    updateApprovalPopoutPosition();
  }

  async function getHealth() {
    const response = await fetch(AGENT_BASE_URL + "/health");
    const payload = await response.json();
    state.health = payload;
    if (payload.config?.projectRoot) {
      window.__REFORM_PROJECT_ROOT__ = payload.config.projectRoot;
    }
    if (payload.framework) {
      state.detectedFramework = payload.framework;
      const badge = document.getElementById("reform-framework-badge");
      if (badge) {
        const label = payload.framework.name + (payload.framework.metaFramework ? " / " + payload.framework.metaFramework : "");
        badge.textContent = label;
        badge.style.display = "";
      }
    }
    const config = {
      ...payload.config,
      appUrl: window.location.origin,
      llmProvider: payload.config?.llmProvider || "openrouter",
      llmFallbackProvider: payload.config?.llmFallbackProvider ?? "zai",
    };
    state.configText = JSON.stringify(config, null, 2);
    els.config.value = state.configText;
    persistOverlayState();
    validateConfigEditor();
    renderState();
    if (!state.testSuggestions.length || state.testSuggestionsMessage.startsWith("Could not resolve")) {
      void buildSuggestedTests();
    }
  }

  async function postJson(path, body) {
    const response = await fetch(AGENT_BASE_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Request failed");
    return payload;
  }

  toggle.addEventListener("click", () => {
    if (state.editModeEnabled) {
      exitEditModeAndOpenOverlay();
      return;
    }
    setCollapsed(false);
  });

  els.collapseButton.addEventListener("click", () => {
    setCollapsed(true);
  });

  els.recordButton.addEventListener("click", () => {
    state.recorderEnabled = !state.recorderEnabled;
    renderRecorder();
    persistOverlayState();
  });

  els.editModeToggle.addEventListener("click", async () => {
    await toggleEditMode();
  });

  els.actionKind.addEventListener("change", () => {
    renderActionBuilder();
  });

  els.refreshTargetsButton.addEventListener("click", () => {
    buildAvailableTargets();
    renderActionBuilder();
  });

  els.addStepButton.addEventListener("click", () => {
    addActionFromBuilder();
  });

  els.clearRecordingButton.addEventListener("click", () => {
    state.recordedActions = [];
    renderRecorder();
    syncRecordedActionsIntoConfig();
    persistOverlayState();
  });

  els.scanButton.addEventListener("click", () => {
    void buildSuggestedTests();
    renderActionBuilder();
  });

  els.recorderList.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) return;

    if (target.dataset.action === "remove") removeRecordedAction(index);
    if (target.dataset.action === "up") moveRecordedAction(index, -1);
    if (target.dataset.action === "down") moveRecordedAction(index, 1);
  });

  els.suggestionList.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const index = Number(target.dataset.suggestionIndex);
    if (Number.isNaN(index)) return;
    useSuggestedTest(index);
  });

  let routeObserverInstalled = false;
  function refreshSuggestionsForCurrentRoute() {
    if (!state.testSuggestionsLoading) {
      void buildSuggestedTests();
    }
  }

  function installRouteObservers() {
    if (routeObserverInstalled) return;
    routeObserverInstalled = true;

    const rerun = () => {
      refreshSuggestionsForCurrentRoute();
    };

    window.addEventListener("popstate", rerun);
    window.addEventListener("hashchange", rerun);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event("reform:locationchange"));
      return result;
    };
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("reform:locationchange"));
      return result;
    };
    window.addEventListener("reform:locationchange", rerun);
  }

  els.config.addEventListener("input", () => {
    state.configText = els.config.value;
    validateConfigEditor();
    persistOverlayState();
  });

  els.llmProvider.addEventListener("change", () => {
    updateConfigFromLlmControls();
  });

  els.llmModel.addEventListener("input", () => {
    updateConfigFromLlmControls();
  });

  els.runButton.addEventListener("click", async () => {
    if (!validateConfigEditor()) {
      return;
    }
    const parsed = JSON.parse(els.config.value || "{}");
    parsed.appUrl = window.location.origin;
    parsed.appUrl = window.location.origin;
    await startLocalRun(parsed);
  });

  els.approveButton.addEventListener("click", async () => {
    await postJson("/approve");
  });

  els.rejectButton.addEventListener("click", async () => {
    await postJson("/reject");
  });

  els.popoutApproveButton.addEventListener("click", async () => {
    await postJson("/approve");
  });

  els.popoutRejectButton.addEventListener("click", async () => {
    await postJson("/reject");
  });

  let socket = null;
  let reconnectTimer = null;
  let manualSocketClose = false;

  function scheduleSocketReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      state.socketState = "connecting";
      renderState();
      connectSocket();
    }, 1200);
  }

  function connectSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    socket = new WebSocket(WS_URL);
    socket.addEventListener("open", () => {
      manualSocketClose = false;
      state.socketState = "open";
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      renderState();
    });
    socket.addEventListener("close", () => {
      state.socketState = "closed";
      renderState();
      if (!manualSocketClose) {
        scheduleSocketReconnect();
      }
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") {
        const previousStage = state.repairState ? state.repairState.stage : null;
        state.repairState = message.payload;
        flagTabActivity("monitor", "activity");
        if (message.payload.screenshots?.beforePath || message.payload.screenshots?.afterPath) {
          flagTabActivity("evidence", "activity");
        }
        if (message.payload.stage !== previousStage) {
          pushTimelineEntry({
            kind: "stage",
            timestamp: message.payload.timestamp || new Date().toISOString(),
            title: prettifyStage(message.payload.stage),
            detail: message.payload.detail || "Stage updated.",
          });
        }
        if (!message.payload.pendingPatch) {
          state.pendingPatch = null;
        }
        if (
          state.localRun?.awaitingPatchedRetry &&
          message.payload.stage === "needs_review" &&
          /Patch applied from captured same-tab failure evidence/i.test(message.payload.detail || "")
        ) {
          const nextRetryCount = (state.localRun.snapshot.run.retryCount ?? 1) + 1;
          if (nextRetryCount <= (state.localRun.snapshot.run.maxRetries ?? 3)) {
            pushLocalLog("info", "local_runner_retrying: Replaying the same-tab flow after the approved patch.");
            window.setTimeout(() => {
              void startLocalRun(state.localRun.config);
            }, 1200);
          } else {
            state.localRun.awaitingPatchedRetry = false;
            pushLocalLog("warn", "local_runner_retry_limit: Reached the maximum same-tab replay attempts after patching.");
          }
        }
        if (message.payload.stage === "verified" && message.payload.stage !== previousStage) {
          triggerSuccessBurst();
        }
        renderState();
      }
      if (message.type === "log") {
        flagTabActivity("monitor", "activity");
        state.logs.push(message.payload);
        if (message.payload.level !== "info" || /primary_flow_passed|approval|failed|verified|needs_review/i.test(message.payload.message || "")) {
          pushTimelineEntry({
            kind: "log",
            timestamp: message.payload.timestamp || new Date().toISOString(),
            title: message.payload.level === "error" ? "Error Event" : message.payload.level === "warn" ? "Warning Event" : "Run Event",
            detail: message.payload.message || "",
          });
        }
        renderLogs();
        renderTimeline();
      }
      if (message.type === "logs") {
        state.logs = message.payload;
        renderLogs();
      }
      if (message.type === "approval_requested") {
        state.pendingPatch = message.payload;
        flagTabActivity("review", "attention");
        if (state.activeTab !== "review") {
          switchTab("review");
        }
        pushTimelineEntry({
          kind: "approval",
          timestamp: new Date().toISOString(),
          title: "Patch Approval Requested",
          detail: message.payload.rationale || "A patch proposal is ready for review.",
        });
        renderPendingPatch();
        renderTimeline();
      }
    });
  }

  connectSocket();
  getHealth().catch((error) => {
    state.logs.push({ id: String(Date.now()), timestamp: new Date().toISOString(), level: "error", message: error.message });
    renderLogs();
  });

  installRouteObservers();
  void buildSuggestedTests();
  renderActionBuilder();
  maybeResumeLocalRun();
  const handleResize = () => {
    updateOverlayWidth();
    updateApprovalPopoutPosition();
  };
  window.addEventListener("resize", handleResize);

  document.addEventListener("click", handleRecordingClick, true);
  document.addEventListener("focusin", handleRecordingInput, true);
  document.addEventListener("change", handleRecordingChange, true);

  window.__REFORM_OVERLAY__ = {
    open() {
      if (state.editModeEnabled) {
        exitEditModeAndOpenOverlay();
        return;
      }
      setCollapsed(false);
    },
    close() { setCollapsed(true); },
    destroy() {
      manualSocketClose = true;
      socket?.close();
      document.removeEventListener("click", handleRecordingClick, true);
      document.removeEventListener("focusin", handleRecordingInput, true);
      document.removeEventListener("change", handleRecordingChange, true);
      window.removeEventListener("resize", handleResize);
      if (state.selectedElement) state.selectedElement.classList.remove("reform-highlight");
      persistOverlayState();
      root.remove();
      approvalPopout.remove();
      toggle.remove();
      style.remove();
      delete window.__REFORM_OVERLAY__;
    },
  };
  setCollapsed(state.collapsed);
  updateOverlayWidth();
  updateApprovalPopoutPosition();
  renderEditToggle();
  applyEditModeVisuals(state.editModeEnabled);
  if (state.editModeEnabled) {
    (async () => {
      await ensureEditModeScript();
      window.setTimeout(() => {
        window.__REFORM_EDIT_MODE__?.enable();
      }, 200);
    })();
  }
})();`;
}
