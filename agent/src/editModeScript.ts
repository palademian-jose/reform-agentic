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
      z-index: 2147483646 !important;
      border: 2px solid rgba(108, 159, 255, 0.9) !important;
      border-radius: 4px !important;
      background: rgba(108, 159, 255, 0.08) !important;
      transition: all 120ms ease !important;
      display: none !important;
    }
    #reform-edit-highlight.active { display: block !important; }
    #reform-edit-badge {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
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
      z-index: 2147483646 !important;
      width: 320px !important;
      border-radius: 12px !important;
      background: rgba(13, 17, 26, 0.96) !important;
      border: 1px solid rgba(108, 159, 255, 0.2) !important;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4) !important;
      font-family: sans-serif !important;
      color: #f6f1e7 !important;
      display: none !important;
      overflow: hidden !important;
      pointer-events: auto !important;
    }
    .reform-edit-popup.visible { display: block !important; }
    .reform-edit-popup-header { padding: 12px !important; border-bottom: 1px solid rgba(255,255,255,0.1) !important; }
    .reform-edit-popup-header h4 { margin: 0 0 4px !important; font-size: 13px !important; color: #a5b8ff !important; }
    .reform-edit-popup-header p { margin: 0 !important; font-size: 11px !important; color: rgba(255,255,255,0.6) !important; }
    .reform-edit-popup-body { padding: 12px !important; display: grid !important; gap: 8px !important; }
    .reform-edit-textarea {
      width: 100% !important; min-height: 60px !important; resize: vertical !important;
      border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.1) !important;
      padding: 8px !important; background: rgba(0,0,0,0.3) !important; color: inherit !important;
      font: 12px/1.4 monospace !important;
    }
    .reform-edit-actions { display: flex !important; gap: 8px !important; flex-wrap: wrap !important; }
    .reform-edit-btn {
      border-radius: 999px !important; padding: 8px 14px !important; font-size: 12px !important;
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
      display: flex !important;
      align-items: flex-start !important;
      gap: 10px !important;
      padding: 8px 0 !important;
    }
    .reform-progress-step + .reform-progress-step {
      border-top: 1px solid rgba(255,255,255,0.06) !important;
    }
    .reform-progress-icon {
      width: 20px !important;
      height: 20px !important;
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
      font-size: 11px !important;
      line-height: 1.4 !important;
      color: rgba(246, 241, 231, 0.9) !important;
    }
    .reform-progress-subtext {
      font-size: 10px !important;
      color: rgba(255,255,255,0.4) !important;
      font-family: monospace !important;
      margin-top: 2px !important;
      word-break: break-all !important;
    }
    .reform-progress-error {
      font-size: 11px !important;
      color: #ff7a7a !important;
      padding: 8px 0 !important;
    }
    #reform-edit-status-card {
      position: fixed !important;
      left: 20px !important;
      bottom: 20px !important;
      z-index: 2147483646 !important;
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
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div>
          <h4 style="margin:0 0 4px;">Element Selected</h4>
          <p id="reform-edit-element-info" style="margin:0;">—</p>
        </div>
        <button id="reform-edit-close" style="background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0;line-height:1;">×</button>
      </div>
    </div>
    <div class="reform-edit-popup-body" id="reform-edit-popup-body">
      <div class="reform-edit-actions">
        <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-fix">Auto Fix</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-prompt">Custom Prompt</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-cancel">Cancel</button>
      </div>
      <textarea class="reform-edit-textarea" id="reform-prompt-input" style="display:none" placeholder="Describe what you want to change..."></textarea>
      <div class="reform-edit-actions" id="reform-generate-actions" style="display:none">
        <button class="reform-edit-btn reform-edit-btn-primary" id="reform-generate">Generate</button>
      </div>
    </div>
  \`;
  document.body.appendChild(popup);

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
    let current = el;

    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey) {
      let fiber = el[fiberKey];
      while (fiber) {
        if (typeof fiber.type === 'function' || typeof fiber.type === 'object') {
          const name = fiber.type.displayName || fiber.type.name || null;
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
      const name = el.__vue__.$options.name || null;
      let parent = el.__vue__.$parent;
      while (parent) {
        const parentName = parent.$options.name;
        if (parentName) parentNames.push(parentName);
        parent = parent.$parent;
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

    const compName = extractComponentName(el);
    badge.textContent = (el.tagName.toLowerCase()) + (compName ? ' / ' + compName : '');
    badge.style.left = rect.left + 'px';
    badge.style.top = (rect.top - 22) + 'px';
    badge.classList.add('active');
  }

  function hideHighlight() {
    highlight.classList.remove('active');
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
    body.innerHTML = '<div id="reform-progress-container"></div>';
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
        '<div><div class="reform-progress-text">' + step.detail + '</div>' + subtext + '</div>' +
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
  function showPopup(el) {
    const desc = getElementDescriptor(el);
    editState.selectedElement = el;
    progressSteps.length = 0;

    const body = document.getElementById('reform-edit-popup-body');
    body.innerHTML = \`
      <div class="reform-edit-actions">
        <button class="reform-edit-btn reform-edit-btn-primary" id="reform-auto-fix">Auto Fix</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-custom-prompt">Custom Prompt</button>
        <button class="reform-edit-btn reform-edit-btn-secondary" id="reform-cancel">Cancel</button>
      </div>
      <textarea class="reform-edit-textarea" id="reform-prompt-input" style="display:none" placeholder="Describe what you want to change..."></textarea>
      <div class="reform-edit-actions" id="reform-generate-actions" style="display:none">
        <button class="reform-edit-btn reform-edit-btn-primary" id="reform-generate">Generate</button>
      </div>
    \`;

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

    document.getElementById('reform-edit-element-info').textContent =
      desc.componentName || desc.tagName + (desc.id ? '#' + desc.id : '');

    const rect = el.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 200;

    let left = rect.right + 10;
    let top = rect.top;

    if (left + popupWidth > window.innerWidth - 10) {
      left = Math.max(10, rect.left - popupWidth - 10);
    }
    if (top + popupHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - popupHeight - 10);
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.classList.add('visible');
  }

  function hidePopup() {
    popup.classList.remove('visible');
    closeWebSocket();
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    progressSteps.length = 0;
    editState.locked = false;
    editState.proposal = null;
  }

  async function proposeEdit(mode, customPrompt) {
    const el = editState.selectedElement;
    if (!el) return;

    editState.loading = true;
    editState.locked = true;
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
      }
      // If data.ok, progress updates will come via WebSocket
    } catch (err) {
      closeWebSocket();
      showProgressError(err.message);
      editState.locked = false;
    }
    editState.loading = false;
  }

  function showProposal(proposal) {
    editState.locked = true;
    editState.proposal = proposal;

    const container = document.getElementById('reform-progress-container');
    if (!container) return;

    // Separator between steps and proposal
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin:4px 0;';
    container.appendChild(sep);

    // Confidence + rationale
    const info = document.createElement('div');
    info.style.cssText = 'padding:4px 0 8px;';
    info.innerHTML =
      '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">Confidence: ' +
      Math.round(proposal.confidence * 100) + '%</div>' +
      '<div style="font-size:11px;opacity:0.7;line-height:1.5;">' +
      escapeHtml(proposal.rationale.slice(0, 300)) + '</div>';
    container.appendChild(info);

    // Patch files summary
    if (proposal.patches && proposal.patches.length > 0) {
      const filesDiv = document.createElement('div');
      filesDiv.style.cssText = 'padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.04);margin-bottom:8px;font-size:11px;color:rgba(255,255,255,0.6);';
      filesDiv.innerHTML = proposal.patches.map(p => {
        const fileName = p.filePath.replace(/^.*[\\\\\\/]/, '');
        return '<div style="padding:2px 0;">' + escapeHtml(fileName) + ' <span style="opacity:0.5;">' + escapeHtml(p.reason || '') + '</span></div>';
      }).join('');
      container.appendChild(filesDiv);
    }

    // Apply / Decline buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'reform-edit-actions';

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
        actionsDiv.remove();
        sep.remove();
        const okDiv = document.createElement('div');
        okDiv.style.cssText = 'padding:6px 8px;font-size:11px;color:#9fe2c1;border-radius:8px;background:rgba(159,226,193,0.1);text-align:center;';
        okDiv.textContent = 'Changes applied. Reform kept a revert snapshot.';
        container.appendChild(okDiv);
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
        var errDiv = container.querySelector('.reform-progress-error');
        if (!errDiv) {
          errDiv = document.createElement('div');
          errDiv.className = 'reform-progress-error';
          container.appendChild(errDiv);
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
        actionsDiv.remove();
        sep.remove();
        const undoDiv = document.createElement('div');
        undoDiv.style.cssText = 'padding:6px 8px;font-size:11px;color:#ff7a7a;border-radius:8px;background:rgba(255,122,122,0.1);text-align:center;';
        undoDiv.textContent = 'Changes reverted';
        container.appendChild(undoDiv);
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
    container.appendChild(actionsDiv);
  }

  // --- Event handlers ---
  function handleMouseMove(e) {
    if (!editState.enabled || editState.locked) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target.id === 'reform-overlay-root' || target.closest('#reform-overlay-root') || target.closest('.reform-edit-popup')) {
      hideHighlight();
      return;
    }
    highlightElement(target);
  }

  function handleClick(e) {
    if (!editState.enabled || editState.locked) return;
    const target = e.target;
    if (target.closest('.reform-edit-popup')) return;
    if (target.closest('#reform-overlay-root')) return;

    e.preventDefault();
    e.stopPropagation();

    const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementAtPoint || elementAtPoint.closest('.reform-edit-popup')) return;
    hideHighlight();
    showPopup(elementAtPoint);
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
      document.addEventListener('click', handleClick, true);
    },
    disable() {
      editState.enabled = false;
      persistState();
      hideHighlight();
      hidePopup();
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
    },
    destroy() {
      this.disable();
      closeWebSocket();
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
