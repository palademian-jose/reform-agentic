export function renderEditModeScript(agentBaseUrl: string) {
  return `(() => {
  if (window.__REFORM_EDIT_MODE__) return;
  const AGENT_BASE_URL = ${JSON.stringify(agentBaseUrl)};
  const WS_URL = AGENT_BASE_URL.replace(/^http/, 'ws');
  const STORAGE_KEY = '__REFORM_EDIT_MODE_STATE__';

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

  const editState = {
    enabled: Boolean(persistedState?.enabled),
    hoveredElement: null,
    selectedElement: null,
    proposal: null,
    loading: false,
    customPrompt: "",
    locked: false,
    activeProposalId: typeof persistedState?.activeProposalId === 'string' ? persistedState.activeProposalId : null,
    pendingApplyProposalId: typeof persistedState?.pendingApplyProposalId === 'string' ? persistedState.pendingApplyProposalId : null,
  };

  let editSocket = null;

  function persistState() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: editState.enabled,
        activeProposalId: editState.activeProposalId,
        pendingApplyProposalId: editState.pendingApplyProposalId,
      }));
    } catch {
      // Ignore storage failures.
    }
  }

  function clearPersistedProposalState() {
    editState.activeProposalId = null;
    editState.pendingApplyProposalId = null;
    persistState();
  }

  // Create edit mode styles
  const style = document.createElement("style");
  style.textContent = \`
    #reform-edit-highlight {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483648 !important;
      border: 2px solid rgba(108, 159, 255, 0.9) !important;
      border-radius: 4px !important;
      background: rgba(108, 159, 255, 0.08) !important;
      transition: all 120ms ease !important;
      display: none !important;
    }
    #reform-edit-highlight.dimmed {
      background: rgba(255, 255, 255, 0.04) !important;
      border-color: rgba(255, 193, 107, 0.95) !important;
      box-shadow:
        0 0 0 9999px rgba(5, 8, 14, 0.62),
        0 0 0 2px rgba(255, 193, 107, 0.22),
        0 0 28px rgba(255, 193, 107, 0.3) !important;
    }
    #reform-edit-highlight.active { display: block !important; }
    #reform-edit-badge {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483648 !important;
      padding: 2px 8px !important;
      border-radius: 4px !important;
      background: rgba(13, 17, 26, 0.9) !important;
      border: 1px solid rgba(108, 159, 255, 0.4) !important;
      color: #a5b8ff !important;
      font-size: 11px !important;
      font-family: monospace !important;
      display: none !important;
    }
    #reform-edit-badge.active { display: block !important; }
    .reform-edit-popup {
      position: fixed !important;
      z-index: 2147483649 !important;
      width: min(380px, calc(100vw - 24px)) !important;
      max-height: calc(100vh - 24px) !important;
      border-radius: 20px !important;
      background:
        radial-gradient(circle at top right, rgba(108, 159, 255, 0.16), transparent 34%),
        radial-gradient(circle at top left, rgba(159, 226, 193, 0.12), transparent 38%),
        rgba(13, 17, 26, 0.98) !important;
      border: 1px solid rgba(108, 159, 255, 0.22) !important;
      box-shadow: 0 24px 72px rgba(0,0,0,0.46) !important;
      font-family: sans-serif !important;
      color: #f6f1e7 !important;
      display: none !important;
      overflow: hidden !important;
      pointer-events: auto !important;
      opacity: 0 !important;
      transform: translate3d(0, 8px, 0) scale(0.98) !important;
      visibility: hidden !important;
      will-change: left, top, transform, opacity !important;
      transition: opacity 140ms ease, transform 140ms ease !important;
    }
    .reform-edit-popup.visible { display: block !important; opacity: 1 !important; transform: translate3d(0, 0, 0) scale(1) !important; visibility: visible !important; }
    .reform-edit-popup[data-dragging="true"] {
      transition: none !important;
      cursor: grabbing !important;
    }
    .reform-edit-popup-header {
      padding: 16px 16px 14px !important;
      border-bottom: 1px solid rgba(255,255,255,0.08) !important;
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0)) !important;
    }
    .reform-edit-popup-drag-handle {
      display: grid !important;
      gap: 4px !important;
      flex: 1 1 auto !important;
      min-width: 0 !important;
      cursor: grab !important;
      user-select: none !important;
      touch-action: none !important;
    }
    .reform-edit-popup[data-dragging="true"] .reform-edit-popup-drag-handle { cursor: grabbing !important; }
    .reform-edit-popup-drag-handle h4,
    .reform-edit-popup-drag-handle p {
      pointer-events: none !important;
    }
    .reform-edit-popup-header h4 { margin: 0 0 4px !important; font-size: 14px !important; color: #c8d7ff !important; }
    .reform-edit-popup-header p { margin: 0 !important; font-size: 11px !important; color: rgba(255,255,255,0.68) !important; line-height: 1.45 !important; }
    .reform-edit-popup-body { padding: 14px 16px 16px !important; display: grid !important; gap: 12px !important; overflow: auto !important; }
    .reform-edit-popup-section {
      display: grid !important;
      gap: 10px !important;
      padding: 12px !important;
      border-radius: 16px !important;
      background: rgba(255,255,255,0.04) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
    }
    .reform-edit-popup-section-title {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 10px !important;
      font-size: 11px !important;
      letter-spacing: 0.08em !important;
      text-transform: uppercase !important;
      color: rgba(255,255,255,0.58) !important;
    }
    .reform-edit-popup-section-copy {
      font-size: 12px !important;
      line-height: 1.55 !important;
      color: rgba(255,255,255,0.74) !important;
    }
    .reform-edit-category-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 8px !important;
    }
    .reform-edit-category-btn {
      width: 100% !important;
      border-radius: 14px !important;
      padding: 10px 12px !important;
      border: 1px solid rgba(255,255,255,0.12) !important;
      background: rgba(255,255,255,0.05) !important;
      color: inherit !important;
      text-align: left !important;
      cursor: pointer !important;
      transition: border-color 140ms ease, background 140ms ease, transform 140ms ease !important;
    }
    .reform-edit-category-btn:hover {
      transform: translateY(-1px) !important;
      border-color: rgba(159,226,193,0.26) !important;
      background: rgba(255,255,255,0.08) !important;
    }
    .reform-edit-category-btn[data-selected="true"] {
      border-color: rgba(159,226,193,0.45) !important;
      background: rgba(159,226,193,0.12) !important;
    }
    .reform-edit-category-name {
      font-size: 12px !important;
      font-weight: 700 !important;
      line-height: 1.35 !important;
      color: #f7f3ea !important;
    }
    .reform-edit-category-desc {
      margin-top: 4px !important;
      font-size: 10px !important;
      line-height: 1.45 !important;
      color: rgba(255,255,255,0.65) !important;
    }
    .reform-edit-textarea {
      width: 100% !important; min-height: 60px !important; resize: vertical !important;
      border-radius: 12px !important; border: 1px solid rgba(255,255,255,0.1) !important;
      padding: 10px 12px !important; background: rgba(0,0,0,0.3) !important; color: inherit !important;
      font: 12px/1.4 monospace !important;
    }
    .reform-edit-actions { display: flex !important; gap: 10px !important; flex-wrap: wrap !important; }
    .reform-edit-btn {
      border-radius: 999px !important; padding: 9px 14px !important; font-size: 12px !important;
      border: 0 !important; cursor: pointer !important; font-weight: 600 !important;
    }
    .reform-edit-btn-primary { background: linear-gradient(135deg, #6c9fff, #9fe2c1) !important; color: #0e121a !important; }
    .reform-edit-btn-secondary { background: rgba(255,255,255,0.1) !important; color: inherit !important; border: 1px solid rgba(255,255,255,0.2) !important; }
    .reform-spinner {
      width: 16px !important;
      height: 16px !important;
      border: 2px solid rgba(108, 159, 255, 0.3) !important;
      border-top-color: #6c9fff !important;
      border-radius: 50% !important;
      animation: reform-spin 0.8s linear infinite !important;
      flex-shrink: 0 !important;
    }
    @keyframes reform-spin {
      to { transform: rotate(360deg); }
    }
    .reform-progress-step {
      display: grid !important;
      grid-template-columns: 24px minmax(0, 1fr) !important;
      gap: 10px !important;
      padding: 12px !important;
      border-radius: 14px !important;
      background: rgba(0,0,0,0.16) !important;
      border: 1px solid rgba(255,255,255,0.05) !important;
    }
    .reform-progress-step + .reform-progress-step {
      margin-top: 8px !important;
    }
    .reform-progress-icon {
      width: 24px !important;
      height: 24px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      font-size: 10px !important;
    }
    .reform-progress-icon.done {
      background: rgba(159, 226, 193, 0.2) !important;
      color: #9fe2c1 !important;
    }
    .reform-progress-icon.active {
      background: rgba(108, 159, 255, 0.2) !important;
      color: #6c9fff !important;
    }
    .reform-progress-text {
      font-size: 12px !important;
      line-height: 1.5 !important;
      color: rgba(246, 241, 231, 0.95) !important;
      font-weight: 600 !important;
    }
    .reform-progress-subtext {
      font-size: 10px !important;
      color: rgba(255,255,255,0.4) !important;
      font-family: monospace !important;
      margin-top: 2px !important;
      word-break: break-all !important;
    }
    .reform-progress-error {
      font-size: 12px !important;
      color: #ff7a7a !important;
      padding: 6px 0 0 !important;
    }
    .reform-progress-shell {
      display: grid !important;
      gap: 12px !important;
    }
    .reform-progress-head {
      display: flex !important;
      justify-content: space-between !important;
      align-items: flex-start !important;
      gap: 10px !important;
    }
    .reform-progress-kicker {
      font-size: 11px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      color: rgba(255,255,255,0.5) !important;
      margin-bottom: 4px !important;
    }
    .reform-progress-title {
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1.35 !important;
      color: #f7f3ea !important;
    }
    .reform-progress-chip {
      flex: 0 0 auto !important;
      border-radius: 999px !important;
      padding: 6px 10px !important;
      background: rgba(159, 226, 193, 0.14) !important;
      border: 1px solid rgba(159, 226, 193, 0.18) !important;
      color: #c9f8de !important;
      font-size: 11px !important;
      font-weight: 700 !important;
    }
    .reform-progress-note {
      font-size: 12px !important;
      line-height: 1.55 !important;
      color: rgba(255,255,255,0.72) !important;
      padding: 12px !important;
      border-radius: 14px !important;
      background: rgba(255,255,255,0.04) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
    }
    .reform-progress-list {
      display: grid !important;
      gap: 8px !important;
    }
    .reform-progress-nextsteps,
    .reform-progress-proposal {
      border-radius: 16px !important;
      padding: 12px !important;
      background: rgba(255,255,255,0.04) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
      display: grid !important;
      gap: 8px !important;
    }
    .reform-progress-nextsteps {
      border-left: 3px solid rgba(255, 193, 106, 0.95) !important;
    }
    .reform-progress-nextsteps-title,
    .reform-progress-proposal-title {
      font-size: 11px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      color: rgba(255,255,255,0.56) !important;
    }
    .reform-progress-nextsteps-copy {
      font-size: 12px !important;
      line-height: 1.5 !important;
      color: rgba(255,255,255,0.76) !important;
    }
    .reform-progress-proposal-head {
      display: flex !important;
      justify-content: space-between !important;
      gap: 10px !important;
      align-items: flex-start !important;
    }
    .reform-progress-confidence {
      font-size: 12px !important;
      font-weight: 700 !important;
      color: #c9f8de !important;
    }
    .reform-progress-rationale {
      font-size: 12px !important;
      line-height: 1.55 !important;
      color: rgba(255,255,255,0.76) !important;
    }
    .reform-progress-files {
      display: grid !important;
      gap: 8px !important;
      padding: 10px !important;
      border-radius: 12px !important;
      background: rgba(0,0,0,0.16) !important;
      border: 1px solid rgba(255,255,255,0.05) !important;
    }
    .reform-progress-file {
      display: flex !important;
      justify-content: space-between !important;
      gap: 8px !important;
      font-size: 11px !important;
      line-height: 1.45 !important;
      color: rgba(255,255,255,0.72) !important;
    }
    .reform-progress-file strong {
      color: rgba(255,255,255,0.92) !important;
    }
    .reform-progress-actions {
      display: flex !important;
      gap: 10px !important;
      flex-wrap: wrap !important;
      padding-top: 2px !important;
    }
    #reform-edit-status-card {
      position: fixed !important;
      left: 20px !important;
      bottom: 20px !important;
      z-index: 2147483649 !important;
      width: min(340px, calc(100vw - 40px)) !important;
      border-radius: 14px !important;
      border: 1px solid rgba(108, 159, 255, 0.22) !important;
      background: rgba(13, 17, 26, 0.96) !important;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35) !important;
      color: #f6f1e7 !important;
      font: 12px/1.5 sans-serif !important;
      padding: 12px !important;
      display: none !important;
    }
    #reform-edit-status-card.visible { display: block !important; }
    .reform-edit-status-title {
      font-size: 12px !important;
      font-weight: 700 !important;
      color: #a5b8ff !important;
      margin-bottom: 4px !important;
    }
    .reform-edit-status-copy {
      color: rgba(255,255,255,0.72) !important;
      margin-bottom: 10px !important;
    }
  \`;
  document.head.appendChild(style);

  // Create DOM elements
  const highlight = document.createElement("div");
  highlight.id = "reform-edit-highlight";
  document.body.appendChild(highlight);

  const badge = document.createElement("div");
  badge.id = "reform-edit-badge";
  document.body.appendChild(badge);

  const popup = document.createElement("div");
  popup.className = "reform-edit-popup";
  popup.innerHTML = \`
    <div class="reform-edit-popup-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div class="reform-edit-popup-drag-handle" id="reform-edit-drag-handle">
          <h4 style="margin:0 0 4px;">Element Selected</h4>
          <p id="reform-edit-element-info" style="margin:0;">—</p>
        </div>
        <button id="reform-edit-close" style="background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0;line-height:1;opacity:0.8;">×</button>
      </div>
    </div>
    <div class="reform-edit-popup-body" id="reform-edit-popup-body">
      <div class="reform-edit-popup-section">
        <div class="reform-edit-popup-section-title">
          <span>Selected element</span>
          <span id="reform-edit-element-chip">—</span>
        </div>
        <div class="reform-edit-popup-section-copy" id="reform-edit-element-summary">Choose how Reform should change this element.</div>
      </div>
      <div class="reform-edit-popup-section" id="reform-auto-section" style="display:none">
        <div class="reform-edit-popup-section-title">
          <span>What should change?</span>
          <span>Auto fix</span>
        </div>
        <div class="reform-edit-popup-section-copy">
          Pick the issue type so Reform can focus the generated patch on the right kind of fix.
        </div>
        <div class="reform-edit-category-grid" id="reform-auto-category-grid">
          <button class="reform-edit-category-btn" type="button" data-category="layout">
            <div class="reform-edit-category-name">Layout</div>
            <div class="reform-edit-category-desc">Structure, alignment, and placement.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="spacing">
            <div class="reform-edit-category-name">Spacing</div>
            <div class="reform-edit-category-desc">Padding, margins, and breathing room.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="design">
            <div class="reform-edit-category-name">Design</div>
            <div class="reform-edit-category-desc">Visual style, hierarchy, and polish.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="behavior">
            <div class="reform-edit-category-name">Behavior</div>
            <div class="reform-edit-category-desc">Clicks, state changes, and interaction logic.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="accessibility">
            <div class="reform-edit-category-name">Accessibility</div>
            <div class="reform-edit-category-desc">Keyboard, labels, and assistive support.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="copy">
            <div class="reform-edit-category-name">Copy</div>
            <div class="reform-edit-category-desc">Words, labels, and microcopy.</div>
          </button>
        </div>
        <div class="reform-edit-actions">
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-auto-back">Back</button>
          <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-generate" disabled>Generate Fix</button>
        </div>
      </div>
      <div class="reform-edit-popup-section" id="reform-custom-section" style="display:none">
        <div class="reform-edit-popup-section-title">
          <span>Custom prompt</span>
          <span>Optional</span>
        </div>
        <textarea class="reform-edit-textarea" id="reform-prompt-input" placeholder="Describe what you want to change..."></textarea>
        <div class="reform-edit-actions" id="reform-generate-actions" style="display:none">
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-back">Back</button>
          <button class="reform-edit-btn reform-edit-btn-primary" id="reform-generate">Generate</button>
        </div>
      </div>
      <div class="reform-edit-actions">
        <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-fix">Auto Fix</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-prompt">Custom Prompt</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-cancel">Cancel</button>
      </div>
    </div>
  \`;
  document.body.appendChild(popup);
  const popupDragHandle = popup.querySelector("#reform-edit-drag-handle");

  const popupDragState = {
    active: false,
    offsetX: 0,
    offsetY: 0,
    pointerId: null,
  };

  function clampPopupPosition(left, top) {
    const rect = popup.getBoundingClientRect();
    const padding = 10;
    const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
    return {
      left: Math.max(padding, Math.min(left, maxLeft)),
      top: Math.max(padding, Math.min(top, maxTop)),
    };
  }

  function setPopupPosition(left, top) {
    const next = clampPopupPosition(left, top);
    popup.style.left = next.left + "px";
    popup.style.top = next.top + "px";
  }

  function beginPopupDrag(event) {
    if (!(event instanceof PointerEvent) || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest("button, input, textarea, select, a")) {
      return;
    }

    const rect = popup.getBoundingClientRect();
    popupDragState.active = true;
    popupDragState.pointerId = event.pointerId;
    popupDragState.offsetX = event.clientX - rect.left;
    popupDragState.offsetY = event.clientY - rect.top;
    popup.dataset.dragging = "true";
    popup.style.transform = "none";
    event.stopPropagation();
    event.preventDefault();
  }

  function movePopupDrag(event) {
    if (!popupDragState.active) return;
    if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
    setPopupPosition(event.clientX - popupDragState.offsetX, event.clientY - popupDragState.offsetY);
  }

  function endPopupDrag() {
    if (!popupDragState.active) return;
    if (popupDragState.pointerId !== null && typeof popup.releasePointerCapture === "function" && popup.hasPointerCapture?.(popupDragState.pointerId)) {
      try {
        popup.releasePointerCapture(popupDragState.pointerId);
      } catch {
        // Ignore capture cleanup failures.
      }
    }
    popupDragState.active = false;
    popupDragState.pointerId = null;
    delete popup.dataset.dragging;
  }

  popupDragHandle?.addEventListener("pointerdown", beginPopupDrag);
  window.addEventListener("pointermove", movePopupDrag);
  window.addEventListener("pointerup", endPopupDrag);
  window.addEventListener("pointercancel", endPopupDrag);

  const statusCard = document.createElement("div");
  statusCard.id = "reform-edit-status-card";
  statusCard.innerHTML = \`
    <div class="reform-edit-status-title" id="reform-edit-status-title">Edit applied</div>
    <div class="reform-edit-status-copy" id="reform-edit-status-copy">Reform kept a backup of the previous code so you can revert after the dev server reload.</div>
    <div class="reform-edit-actions">
      <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-edit-status-close">Dismiss</button>
      <button class="reform-edit-btn reform-edit-btn-primary" id="reform-edit-status-revert">Revert</button>
    </div>
  \`;
  document.body.appendChild(statusCard);

  // --- Component name extraction ---
  function extractComponentInfo(el) {
    if (!el) return { componentName: null, parentComponentNames: [] };

    const parentNames = [];

    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey) {
      let fiber = el[fiberKey];
      while (fiber) {
        const fiberType = fiber.type;
        if (fiberType && (typeof fiberType === 'function' || typeof fiberType === 'object')) {
          const name = fiberType.displayName || fiberType.name || null;
          if (name && !parentNames.includes(name)) {
            parentNames.push(name);
          }
        }
        fiber = fiber.return;
      }
      const componentName = parentNames.length > 0 ? parentNames[0] : null;
      return { componentName, parentComponentNames: parentNames.slice(1) };
    }

    if (el.__vue__) {
      const name = el.__vue__?.$options?.name || null;
      let parent = el.__vue__?.$parent || null;
      while (parent) {
        const parentName = parent.$options?.name;
        if (parentName) parentNames.push(parentName);
        parent = parent.$parent || null;
      }
      return { componentName: name, parentComponentNames: parentNames };
    }

    if (el.__vueParentComponent) {
      const name = el.__vueParentComponent.type?.name || null;
      return { componentName: name, parentComponentNames: [] };
    }

    return { componentName: null, parentComponentNames: [] };
  }

  function extractComponentName(el) {
    return extractComponentInfo(el).componentName;
  }

  function getElementDescriptor(el) {
    const rect = el.getBoundingClientRect();
    const componentInfo = extractComponentInfo(el);

    const attributes = {};
    for (const attr of el.attributes || []) {
      if (attr.name.startsWith('data-')) {
        attributes[attr.name] = attr.value;
      }
    }

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      className: typeof el.className === 'string' ? el.className : '',
      textContent: (el.textContent || '').slice(0, 300),
      attributes,
      boundingBox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      componentName: componentInfo.componentName,
      parentComponentNames: componentInfo.parentComponentNames,
      cssSelector: el.id ? '#' + el.id : el.tagName.toLowerCase(),
    };
  }

  // --- Highlight ---
  function highlightElement(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    highlight.classList.add('active');
    highlight.classList.toggle('dimmed', editState.loading || editState.locked);

    const compName = extractComponentName(el);
    badge.textContent = (el.tagName.toLowerCase()) + (compName ? ' / ' + compName : '');
    badge.style.left = rect.left + 'px';
    badge.style.top = (rect.top - 22) + 'px';
    badge.classList.add('active');
  }

  function hideHighlight() {
    highlight.classList.remove('active');
    highlight.classList.remove('dimmed');
    badge.classList.remove('active');
  }

  // --- Progress tracking ---
  const progressSteps = [];
  let progressTimer = null;

  function escapeHtml(text) {
    return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  function showProgressUI() {
    const body = document.getElementById('reform-edit-popup-body');
    body.innerHTML = \`
      <div class="reform-progress-shell">
        <div class="reform-progress-head">
          <div>
            <div class="reform-progress-kicker">Edit mode</div>
            <div class="reform-progress-title">Preparing patch proposal</div>
          </div>
          <div class="reform-progress-chip">Live</div>
        </div>
        <div class="reform-progress-note">
          Reform is locating the owning source file, generating a patch, and preparing the result for review.
        </div>
        <div id="reform-progress-container" class="reform-progress-list"></div>
        <div class="reform-progress-nextsteps" id="reform-progress-nextsteps">
          <div class="reform-progress-nextsteps-title">Next steps</div>
          <div class="reform-progress-nextsteps-copy">
            Wait for the proposal, then choose <strong>Accept</strong> to apply it or <strong>Decline</strong> to discard it.
          </div>
        </div>
        <div id="reform-progress-proposal"></div>
      </div>
    \`;
  }

  function addProgressStep(stage, detail, filePath, lineNumber) {
    // If this is a new stage (different from the current last step),
    // mark the previous step as done and wait before showing the new one
    const lastStep = progressSteps[progressSteps.length - 1];
    if (lastStep && !lastStep.done && lastStep.stage !== stage) {
      // Complete the current step immediately
      lastStep.done = true;
      renderProgressSteps();

      // Clear any pending transition timer
      if (progressTimer) clearTimeout(progressTimer);

      // Wait 1s with green dot before revealing next step
      progressTimer = setTimeout(() => {
        progressSteps.push({ stage, detail, filePath, lineNumber, done: false });
        renderProgressSteps();
      }, 1000);
      return;
    }

    // Same stage — update in place (e.g. filePath gets filled in)
    const existing = progressSteps.find(s => s.stage === stage);
    if (existing) {
      existing.detail = detail;
      existing.filePath = filePath || existing.filePath;
      existing.lineNumber = lineNumber || existing.lineNumber;
    } else {
      progressSteps.push({ stage, detail, filePath, lineNumber, done: false });
    }
    renderProgressSteps();
  }

  function markProgressDone(stage) {
    const step = progressSteps.find(s => s.stage === stage);
    if (step) step.done = true;
    renderProgressSteps();
  }

  function renderProgressSteps() {
    const container = document.getElementById('reform-progress-container');
    if (!container) return;

    container.innerHTML = progressSteps.map(step => {
      const iconClass = step.done ? 'done' : 'active';
      const iconContent = step.done
        ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<div class="reform-spinner"></div>';

      let subtext = '';
      if (step.filePath) {
        subtext = '<div class="reform-progress-subtext">' + step.filePath + (step.lineNumber ? ':' + step.lineNumber : '') + '</div>';
      }

      return '<div class="reform-progress-step">' +
        '<div class="reform-progress-icon ' + iconClass + '">' + iconContent + '</div>' +
        '<div><div class="reform-progress-text">' + escapeHtml(step.detail) + '</div>' + subtext + '</div>' +
      '</div>';
    }).join('');
  }

  function showProgressError(error) {
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    const container = document.getElementById('reform-progress-container');
    if (!container) return;
    // Mark all steps as done
    progressSteps.forEach(s => s.done = true);
    renderProgressSteps();
    highlight.classList.remove('dimmed');
    const errDiv = document.createElement('div');
    errDiv.className = 'reform-progress-error';
    errDiv.textContent = error;
    container.appendChild(errDiv);
  }

  // --- WebSocket ---
  function setupWebSocket() {
    if (editSocket && (editSocket.readyState === WebSocket.CONNECTING || editSocket.readyState === WebSocket.OPEN)) {
      return;
    }

    editSocket = new WebSocket(WS_URL);

    editSocket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }

      if (message.type === "edit_progress") {
        const p = message.payload;
        addProgressStep(p.stage, p.detail, p.filePath, p.lineNumber);
      }

      if (message.type === "edit_complete") {
        closeWebSocket();
        if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
        const proposal = message.payload.proposal;
        editState.proposal = proposal;
        // Mark current step as done
        const lastStep = progressSteps[progressSteps.length - 1];
        if (lastStep && !lastStep.done) lastStep.done = true;
        renderProgressSteps();
        // Wait 1s, then add final step and show proposal
        setTimeout(() => {
          addProgressStep('review', 'Ready to review changes');
          progressSteps.forEach(s => s.done = true);
          renderProgressSteps();
          showProposal(proposal);
        }, 1000);
      }

      if (message.type === "edit_error") {
        closeWebSocket();
        showProgressError(message.payload.error);
        editState.locked = false;
      }
    });

    editSocket.addEventListener("error", () => {
      // WebSocket failed - progress won't update but the HTTP response may still work
    });
  }

  function closeWebSocket() {
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    if (editSocket) {
      editSocket.close();
      editSocket = null;
    }
  }

  function hideStatusCard() {
    statusCard.classList.remove('visible');
  }

  function isEditUiTarget(target) {
    if (!target) return false;
    const overlayRoot = document.getElementById('reform-overlay-root');
    const overlayActive = overlayRoot && !overlayRoot.classList.contains('reform-collapsed');
    if (overlayActive && (target.id === 'reform-overlay-root' || target.closest('#reform-overlay-root'))) {
      return true;
    }
    return Boolean(
      (target.closest('.reform-edit-popup') || target.closest('#reform-edit-status-card') || target.closest('.reform-toggle'))
    );
  }

  function showStatusCard(title, copy, options) {
    const titleEl = document.getElementById('reform-edit-status-title');
    const copyEl = document.getElementById('reform-edit-status-copy');
    const closeBtn = document.getElementById('reform-edit-status-close');
    const revertBtn = document.getElementById('reform-edit-status-revert');

    titleEl.textContent = title;
    copyEl.textContent = copy;
    closeBtn.textContent = options?.closeLabel || 'Dismiss';
    closeBtn.disabled = false;
    revertBtn.style.display = options?.showRevert === false ? 'none' : '';
    revertBtn.disabled = Boolean(options?.revertDisabled);
    if (options?.revertLabel) {
      revertBtn.textContent = options.revertLabel;
    } else {
      revertBtn.textContent = 'Revert';
    }
    statusCard.classList.add('visible');
  }

  async function restoreAppliedSession(proposalId) {
    if (!proposalId) return;
    try {
      const res = await fetch(AGENT_BASE_URL + '/inspect/session?proposalId=' + encodeURIComponent(proposalId));
      if (!res.ok) {
        clearPersistedProposalState();
        hideStatusCard();
        return;
      }
      const data = await res.json();
      if (!data.ok || !data.session) {
        clearPersistedProposalState();
        hideStatusCard();
        return;
      }
      if (data.session.status === 'applied' && data.session.canRevert) {
        editState.activeProposalId = proposalId;
        editState.pendingApplyProposalId = null;
        persistState();
        showStatusCard(
          'Edit applied',
          'The target app reloaded, but Reform kept the previous file snapshot. You can revert this edit at any time.',
        );
        return;
      }
      if (data.session.status === 'draft') {
        editState.activeProposalId = null;
        editState.pendingApplyProposalId = proposalId;
        persistState();
        showStatusCard(
          'Applying edit',
          'Waiting for the edit request to finish while the dev server reloads.',
          { showRevert: false, closeLabel: 'Hide' },
        );
        setTimeout(() => restoreAppliedSession(proposalId), 1200);
        return;
      }
      clearPersistedProposalState();
      hideStatusCard();
    } catch {
      setTimeout(() => restoreAppliedSession(proposalId), 1500);
    }
  }

  async function revertAppliedEdit() {
    if (!editState.activeProposalId) return;
    const revertBtn = document.getElementById('reform-edit-status-revert');
    const closeBtn = document.getElementById('reform-edit-status-close');
    revertBtn.disabled = true;
    closeBtn.disabled = true;
    revertBtn.textContent = 'Reverting...';
    try {
      const res = await fetch(AGENT_BASE_URL + '/inspect/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: editState.activeProposalId }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || 'Revert failed');
      }
      clearPersistedProposalState();
      showStatusCard(
        'Edit reverted',
        'The original code was restored. The target app may refresh again while the dev server rebuilds.',
        { showRevert: false, closeLabel: 'Close' },
      );
    } catch (err) {
      closeBtn.disabled = false;
      revertBtn.disabled = false;
      revertBtn.textContent = 'Revert';
      showStatusCard(
        'Revert failed',
        err.message || 'Could not restore the previous code snapshot.',
      );
    }
  }

  // --- Popup ---
  function showPopup(el, cursorPoint) {
    const desc = getElementDescriptor(el);
    editState.selectedElement = el;
    progressSteps.length = 0;
    let selectedAutoCategory = "";

    const body = document.getElementById('reform-edit-popup-body');
    body.innerHTML = \`
      <div class="reform-edit-popup-section">
        <div class="reform-edit-popup-section-title">
          <span>Selected element</span>
          <span id="reform-edit-element-chip">—</span>
        </div>
        <div class="reform-edit-popup-section-copy" id="reform-edit-element-summary">Choose how Reform should change this element.</div>
      </div>
      <div class="reform-edit-popup-section" id="reform-auto-section" style="display:none">
        <div class="reform-edit-popup-section-title">
          <span>What should change?</span>
          <span>Auto fix</span>
        </div>
        <div class="reform-edit-popup-section-copy">
          Pick the issue type so Reform can focus the generated patch on the right kind of fix.
        </div>
        <div class="reform-edit-category-grid" id="reform-auto-category-grid">
          <button class="reform-edit-category-btn" type="button" data-category="layout">
            <div class="reform-edit-category-name">Layout</div>
            <div class="reform-edit-category-desc">Structure, alignment, and placement.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="spacing">
            <div class="reform-edit-category-name">Spacing</div>
            <div class="reform-edit-category-desc">Padding, margins, and breathing room.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="design">
            <div class="reform-edit-category-name">Design</div>
            <div class="reform-edit-category-desc">Visual style, hierarchy, and polish.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="behavior">
            <div class="reform-edit-category-name">Behavior</div>
            <div class="reform-edit-category-desc">Clicks, state changes, and interaction logic.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="accessibility">
            <div class="reform-edit-category-name">Accessibility</div>
            <div class="reform-edit-category-desc">Keyboard, labels, and assistive support.</div>
          </button>
          <button class="reform-edit-category-btn" type="button" data-category="copy">
            <div class="reform-edit-category-name">Copy</div>
            <div class="reform-edit-category-desc">Words, labels, and microcopy.</div>
          </button>
        </div>
        <div class="reform-edit-actions">
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-auto-back">Back</button>
          <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-generate" disabled>Generate Fix</button>
        </div>
      </div>
      <div class="reform-edit-popup-section" id="reform-custom-section" style="display:none">
        <div class="reform-edit-popup-section-title">
          <span>Custom prompt</span>
          <span>Optional</span>
        </div>
        <textarea class="reform-edit-textarea" id="reform-prompt-input" placeholder="Describe what you want to change..."></textarea>
        <div class="reform-edit-actions" id="reform-generate-actions" style="display:none">
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-back">Back</button>
          <button class="reform-edit-btn reform-edit-btn-primary" id="reform-generate">Generate</button>
        </div>
      </div>
      <div class="reform-edit-popup-section">
        <div class="reform-edit-actions">
          <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-fix">Auto Fix</button>
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-prompt">Custom Prompt</button>
          <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-cancel">Cancel</button>
        </div>
      </div>
    \`;

    document.getElementById('reform-cancel').onclick = hidePopup;
    const autoSection = document.getElementById('reform-auto-section');
    const autoGenerate = document.getElementById('reform-auto-generate');
    const autoBack = document.getElementById('reform-auto-back');
    const autoCategoryButtons = Array.from(document.querySelectorAll('.reform-edit-category-btn'));
    const autoCategoryLabel = (category) => {
      const labels = {
        layout: 'layout',
        spacing: 'spacing',
        design: 'design',
        behavior: 'behavior',
        accessibility: 'accessibility',
        copy: 'copy/text',
      };
      return labels[category] || category;
    };
    const clearAutoCategorySelection = () => {
      selectedAutoCategory = '';
      autoCategoryButtons.forEach((button) => button.dataset.selected = 'false');
      if (autoGenerate) autoGenerate.disabled = true;
    };
    document.getElementById('reform-auto-fix').onclick = () => {
      if (autoSection) autoSection.style.display = 'grid';
      const customSection = document.getElementById('reform-custom-section');
      if (customSection) customSection.style.display = 'none';
      clearAutoCategorySelection();
    };
    if (autoBack) {
      autoBack.onclick = () => {
        if (autoSection) autoSection.style.display = 'none';
        clearAutoCategorySelection();
      };
    }
    document.getElementById('reform-custom-prompt').onclick = () => {
      const customSection = document.getElementById('reform-custom-section');
      const promptInput = document.getElementById('reform-prompt-input');
      const generateActions = document.getElementById('reform-generate-actions');
      if (customSection) customSection.style.display = 'grid';
      if (autoSection) autoSection.style.display = 'none';
      clearAutoCategorySelection();
      if (generateActions) generateActions.style.display = 'flex';
      if (promptInput) {
        promptInput.focus();
        promptInput.select();
      }
    };
    const customBack = document.getElementById('reform-custom-back');
    if (customBack) {
      customBack.onclick = () => {
        const customSection = document.getElementById('reform-custom-section');
        const promptInput = document.getElementById('reform-prompt-input');
        const generateActions = document.getElementById('reform-generate-actions');
        if (customSection) customSection.style.display = 'none';
        if (generateActions) generateActions.style.display = 'none';
        if (promptInput) promptInput.value = '';
      };
    }
    autoCategoryButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.category || '';
        selectedAutoCategory = category;
        autoCategoryButtons.forEach((candidate) => {
          candidate.dataset.selected = candidate === button ? 'true' : 'false';
        });
        if (autoGenerate) autoGenerate.disabled = !selectedAutoCategory;
      });
    });
    document.getElementById('reform-auto-generate').onclick = () => {
      if (!selectedAutoCategory) return;
      const prompt = 'Focus on ' + autoCategoryLabel(selectedAutoCategory) + ' issues for the selected element. Improve the related source code only.';
      proposeEdit('auto', prompt);
    };
    document.getElementById('reform-generate').onclick = () => {
      const prompt = document.getElementById('reform-prompt-input').value.trim();
      if (prompt) proposeEdit('custom', prompt);
    };

    const elementChip = document.getElementById('reform-edit-element-chip');
    const elementSummary = document.getElementById('reform-edit-element-summary');
    document.getElementById('reform-edit-element-info').textContent =
      desc.componentName || desc.tagName + (desc.id ? '#' + desc.id : '');
    if (elementChip) {
      elementChip.textContent = desc.tagName + (desc.id ? '#' + desc.id : '');
    }
    if (elementSummary) {
      const componentLine = desc.componentName ? 'Component: ' + desc.componentName + '. ' : '';
      const textPreview = desc.textContent ? 'Text preview: ' + desc.textContent.slice(0, 100) : 'No text preview available.';
      elementSummary.textContent = componentLine + textPreview;
    }
    const customSection = document.getElementById('reform-custom-section');
    const generateActions = document.getElementById('reform-generate-actions');
    const promptInput = document.getElementById('reform-prompt-input');
    if (autoSection) autoSection.style.display = 'none';
    if (customSection) customSection.style.display = 'none';
    if (generateActions) generateActions.style.display = 'none';
    if (promptInput) promptInput.value = '';
    clearAutoCategorySelection();

    const rect = el.getBoundingClientRect();
    const anchorX = cursorPoint?.x ?? (rect.left + rect.width / 2);
    const anchorY = cursorPoint?.y ?? (rect.top + rect.height / 2);

    popup.classList.add('visible');
    popup.style.visibility = 'hidden';
    popup.style.left = '0px';
    popup.style.top = '0px';

    const popupRect = popup.getBoundingClientRect();
    const gutter = 12;
    const padding = 10;

    const spaceBelow = window.innerHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const spaceRight = window.innerWidth - rect.right - gutter;
    const spaceLeft = rect.left - gutter;

    let top = rect.bottom + gutter;
    if (spaceBelow < popupRect.height && spaceAbove > spaceBelow) {
      top = Math.max(padding, rect.top - popupRect.height - gutter);
    } else if (spaceBelow < popupRect.height) {
      top = Math.max(padding, Math.min(window.innerHeight - popupRect.height - padding, anchorY - popupRect.height / 2));
    }

    let left = rect.right + gutter;
    if (spaceRight < popupRect.width && spaceLeft > spaceRight) {
      left = Math.max(padding, rect.left - popupRect.width - gutter);
    } else if (spaceRight < popupRect.width) {
      left = Math.max(padding, Math.min(window.innerWidth - popupRect.width - padding, anchorX - popupRect.width / 2));
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - popupRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - popupRect.height - padding));

    popup.style.transform = "";
    setPopupPosition(left, top);
    popup.style.visibility = 'visible';
  }

  function hidePopup() {
    endPopupDrag();
    popup.classList.remove('visible');
    closeWebSocket();
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    progressSteps.length = 0;
    editState.locked = false;
    editState.proposal = null;
    highlight.classList.remove('dimmed');
  }

  async function proposeEdit(mode, customPrompt) {
    const el = editState.selectedElement;
    if (!el) return;

    editState.loading = true;
    editState.locked = true;
    highlightElement(el);
    progressSteps.length = 0;

    // Show initial progress UI
    addProgressStep('resolving', 'Finding source file for selected element...');
    showProgressUI();
    setupWebSocket();

    try {
      const desc = getElementDescriptor(el);
      const res = await fetch(AGENT_BASE_URL + '/inspect/propose-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          element: desc,
          mode,
          customPrompt,
          currentUrl: window.location.href,
          projectRoot: window.__REFORM_PROJECT_ROOT__ || '',
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        closeWebSocket();
        showProgressError(data.message || 'Unknown error');
        editState.locked = false;
        highlightElement(el);
      }
      // If data.ok, progress updates will come via WebSocket
    } catch (err) {
      closeWebSocket();
      showProgressError(err.message);
      editState.locked = false;
      highlightElement(el);
    }
    editState.loading = false;
  }

  function showProposal(proposal) {
    editState.locked = true;
    editState.proposal = proposal;
    highlight.classList.remove('dimmed');

    const proposalContainer = document.getElementById('reform-progress-proposal');
    const nextSteps = document.getElementById('reform-progress-nextsteps');
    if (!proposalContainer || !nextSteps) return;

    nextSteps.innerHTML = \`
      <div class="reform-progress-nextsteps-title">Next steps</div>
      <div class="reform-progress-nextsteps-copy">
        Review the generated patch below. Accept applies the file changes, Decline leaves the project untouched.
      </div>
    \`;

    proposalContainer.innerHTML = \`
      <div class="reform-progress-proposal">
        <div class="reform-progress-proposal-head">
          <div>
            <div class="reform-progress-proposal-title">Patch ready</div>
            <div class="reform-progress-confidence">Confidence: \${Math.round(proposal.confidence * 100)}%</div>
          </div>
          <div class="reform-progress-chip">Review</div>
        </div>
        <div class="reform-progress-rationale">\${escapeHtml(proposal.rationale.slice(0, 300))}</div>
        \${proposal.patches && proposal.patches.length > 0 ? \`
          <div class="reform-progress-files">
            \${proposal.patches.map((p) => {
              const fileName = p.filePath.replace(/^.*[\\\\\\/]/, '');
              return \`
                <div class="reform-progress-file">
                  <strong>\${escapeHtml(fileName)}</strong>
                  <span>\${escapeHtml(p.reason || '')}</span>
                </div>
              \`;
            }).join('')}
          </div>
        \` : \`
          <div class="reform-progress-nextsteps-copy">No file patches were generated for this element.</div>
        \`}
        <div class="reform-edit-actions" id="reform-proposal-actions"></div>
      </div>
    \`;

    const actionsDiv = document.getElementById('reform-proposal-actions');
    if (!actionsDiv) return;

    const applyBtn = document.createElement('button');
    applyBtn.className = 'reform-edit-btn reform-edit-btn-primary';
    applyBtn.textContent = 'Accept';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'reform-edit-btn reform-edit-btn-secondary';
    declineBtn.textContent = 'Decline';

    applyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyBtn.disabled = true;
      declineBtn.disabled = true;
      applyBtn.textContent = 'Applying...';
      editState.pendingApplyProposalId = proposal.id;
      persistState();
      try {
        const res = await fetch(AGENT_BASE_URL + '/inspect/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId: proposal.id, approved: true }),
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.message || 'Apply failed');
        }
        editState.activeProposalId = proposal.id;
        editState.pendingApplyProposalId = null;
        persistState();
        const lastStep = progressSteps[progressSteps.length - 1];
        if (lastStep) {
          lastStep.detail = 'Changes applied';
          lastStep.done = true;
          renderProgressSteps();
        }
        actionsDiv.innerHTML = '';
        const okDiv = document.createElement('div');
        okDiv.className = 'reform-progress-nextsteps-copy';
        okDiv.style.color = '#9fe2c1';
        okDiv.textContent = 'Changes applied. Reform kept a revert snapshot.';
        proposalContainer.appendChild(okDiv);
        showStatusCard(
          'Edit applied',
          'The target app may reload now. Reform kept the previous file snapshot so you can revert after the rebuild.',
        );
        setTimeout(() => hidePopup(), 1200);
      } catch (err) {
        console.error('Apply failed:', err);
        applyBtn.disabled = false;
        declineBtn.disabled = false;
        applyBtn.textContent = 'Accept';
        editState.pendingApplyProposalId = null;
        persistState();
        // Show error inline
        var errDiv = proposalContainer.querySelector('.reform-progress-error');
        if (!errDiv) {
          errDiv = document.createElement('div');
          errDiv.className = 'reform-progress-error';
          proposalContainer.appendChild(errDiv);
        }
        errDiv.textContent = 'Failed to apply: ' + (err.message || 'Unknown error');
      }
    });

    declineBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyBtn.disabled = true;
      declineBtn.disabled = true;
      declineBtn.textContent = 'Undoing...';
      try {
        await fetch(AGENT_BASE_URL + '/inspect/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId: proposal.id, approved: false }),
        });
        clearPersistedProposalState();
        // Mark as declined
        const lastStep = progressSteps[progressSteps.length - 1];
        if (lastStep) {
          lastStep.detail = 'Changes declined';
          lastStep.done = true;
          renderProgressSteps();
        }
        actionsDiv.innerHTML = '';
        const undoDiv = document.createElement('div');
        undoDiv.className = 'reform-progress-nextsteps-copy';
        undoDiv.style.color = '#ffb3b3';
        undoDiv.textContent = 'Changes reverted.';
        proposalContainer.appendChild(undoDiv);
        setTimeout(() => hidePopup(), 1200);
      } catch (err) {
        console.error('Decline failed:', err);
        applyBtn.disabled = false;
        declineBtn.disabled = false;
        declineBtn.textContent = 'Decline';
      }
    });

    actionsDiv.appendChild(applyBtn);
    actionsDiv.appendChild(declineBtn);
  }

  // --- Event handlers ---
  function handleMouseMove(e) {
    if (!editState.enabled || editState.locked) return;
    const target = getPageElementAtPoint(e.clientX, e.clientY);
    if (!target || isEditUiTarget(target)) {
      hideHighlight();
      return;
    }
    highlightElement(target);
  }

  function getPageElementAtPoint(x, y) {
    const overlayRoot = document.getElementById('reform-overlay-root');
    let element = document.elementFromPoint(x, y);
    if (overlayRoot && overlayRoot.contains(element)) {
      const prevVisibility = overlayRoot.style.visibility;
      overlayRoot.style.visibility = 'hidden';
      element = document.elementFromPoint(x, y);
      overlayRoot.style.visibility = prevVisibility;
    }
    return element;
  }

  function handleSelectionEvent(e) {
    if (!editState.enabled || editState.locked) return;
    const target = e.target;
    if (isEditUiTarget(target)) return;

    const elementAtPoint = getPageElementAtPoint(e.clientX, e.clientY);
    if (!elementAtPoint || isEditUiTarget(elementAtPoint)) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    hideHighlight();
    showPopup(elementAtPoint, { x: e.clientX, y: e.clientY });
  }

  // --- Setup ---
  document.getElementById('reform-edit-close').onclick = hidePopup;
  document.getElementById('reform-cancel').onclick = hidePopup;

  document.getElementById('reform-auto-fix').onclick = () => proposeEdit('auto', null);

  document.getElementById('reform-custom-prompt').onclick = () => {
    document.getElementById('reform-prompt-input').style.display = 'block';
    document.getElementById('reform-generate-actions').style.display = 'flex';
  };

  document.getElementById('reform-generate').onclick = () => {
    const prompt = document.getElementById('reform-prompt-input').value.trim();
    if (prompt) proposeEdit('custom', prompt);
  };

  document.getElementById('reform-edit-status-close').onclick = hideStatusCard;
  document.getElementById('reform-edit-status-revert').onclick = () => {
    void revertAppliedEdit();
  };

  window.addEventListener('beforeunload', persistState);

  if (editState.activeProposalId || editState.pendingApplyProposalId) {
    setTimeout(() => {
      void restoreAppliedSession(editState.activeProposalId || editState.pendingApplyProposalId);
    }, 150);
  }

  window.__REFORM_EDIT_MODE__ = {
    enable() {
      editState.enabled = true;
      persistState();
      document.addEventListener('mousemove', handleMouseMove, true);
      window.addEventListener('pointerdown', handleSelectionEvent, true);
      window.addEventListener('click', handleSelectionEvent, true);
    },
    disable() {
      editState.enabled = false;
      persistState();
      hideHighlight();
      hidePopup();
      document.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('pointerdown', handleSelectionEvent, true);
      window.removeEventListener('click', handleSelectionEvent, true);
    },
    destroy() {
      this.disable();
      closeWebSocket();
      window.removeEventListener("pointermove", movePopupDrag);
      window.removeEventListener("pointerup", endPopupDrag);
      window.removeEventListener("pointercancel", endPopupDrag);
      window.removeEventListener('beforeunload', persistState);
      hideStatusCard();
      highlight.remove();
      badge.remove();
      popup.remove();
      statusCard.remove();
      style.remove();
      delete window.__REFORM_EDIT_MODE__;
    },
  };
})();`;
}
