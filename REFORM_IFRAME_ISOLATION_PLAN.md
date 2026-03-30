# Reform Iframe Isolation Plan

## Goal

Move Reform out of the target app's page context so target-app dev-server reloads do not destroy Reform itself.

Current behavior:

- Reform injects `overlay.js` and `edit-mode.js` into the target page.
- When Reform writes source files, the target dev server reloads.
- Because Reform lives in the same `window`, Reform reloads too and loses in-memory state.

Target behavior:

- Reform runs in a stable parent shell page.
- The target app runs inside an `iframe`.
- Target reloads only affect the iframe.
- Reform keeps control of overlay state, edit sessions, approvals, and revert actions across reloads.

## Recommended Direction

Build a Reform-controlled shell page served by the agent or dashboard. The shell owns the UI and embeds the target app in an `iframe`.

High-level shape:

- Top-level page: Reform shell
- Child frame: target app
- Agent server: state, edit proposals, apply/revert, repair loop
- Parent/iframe bridge: selection, highlighting, route changes, readiness, and edit actions

This is the best tradeoff between robustness and implementation cost. A browser extension would isolate even better, but it is a larger product change.

## Architecture

### 1. Shell page

Serve a dedicated page such as `/shell` from the agent or dashboard.

Responsibilities:

- Render Reform UI outside the target app context
- Create and manage the target `iframe`
- Persist session state independent of iframe reloads
- Display edit proposals, apply state, revert state, logs, and repair status
- Detect iframe reloads and reconnect automatically

### 2. Target frame bridge

Load a minimal bridge script into the iframe content instead of the full Reform UI runtime.

Responsibilities:

- Report hovered and selected elements to the parent shell
- Expose DOM inspection data needed for element-to-file resolution
- Render frame-local highlight boxes only
- Notify the parent when the frame is reloaded and ready again
- Avoid owning any long-lived edit state

The frame bridge should be disposable and stateless. The shell should be the source of truth.

### 3. Agent-backed session model

Keep edit sessions and backups on the agent until the user explicitly accepts-and-clears or reverts.

Responsibilities:

- Proposal creation
- Apply
- Revert
- Session lookup
- Recovery after iframe reload

Some of this already exists and can be reused.

## Codebase Impact

### Replace injection-first UI ownership

Current entry points:

- [reform-cli.mjs](/home/deimos/Projects/Reform/scripts/reform-cli.mjs)
- [proxy-server.mjs](/home/deimos/Projects/Reform/scripts/proxy-server.mjs)
- [overlayScript.ts](/home/deimos/Projects/Reform/agent/src/overlayScript.ts)
- [editModeScript.ts](/home/deimos/Projects/Reform/agent/src/editModeScript.ts)

Planned change:

- Stop treating `overlay.js` as the main product surface
- Introduce a shell page as the main entry point
- Reduce `overlayScript.ts` into either:
  - a frame bridge script, or
  - a temporary compatibility layer during migration

### Add parent/iframe messaging

Introduce a typed message protocol in `shared/` for:

- iframe ready
- hovered element changed
- element selected
- route changed
- request inspect/propose/apply/revert
- highlight target
- clear highlight
- edit mode enabled/disabled

Likely file area:

- [shared/types.ts](/home/deimos/Projects/Reform/shared/types.ts)
- possibly a new `shared/frameBridge.ts` or similar

### Shell UI ownership

The UI currently built inside [overlayScript.ts](/home/deimos/Projects/Reform/agent/src/overlayScript.ts) should move into a stable host, ideally the dashboard or an agent-served HTML page.

Practical option:

- Reuse dashboard UI patterns
- Add a focused shell mode that embeds the target app frame

## Migration Plan

### Phase 1. Create shell page

- Add a new route/page that renders:
  - Reform controls
  - target `iframe`
  - connection state
- Point CLI output to the shell URL instead of the proxy-injected target page

Success criteria:

- Opening Reform lands on the shell page
- The target app loads inside an iframe
- Reloading the target app does not remove Reform UI

### Phase 2. Add frame bridge

- Inject a small bridge script into the iframe content
- Move element hover/select capture into the bridge
- Send events to the parent shell via `postMessage`

Success criteria:

- Parent shell receives live hover/selection data
- Highlights still align inside the iframe
- Full iframe reload reconnects automatically

### Phase 3. Move edit mode ownership to shell

- Keep edit-mode state only in the parent shell
- Use the bridge only for DOM targeting and highlight rendering
- Parent shell calls the agent for propose/apply/revert

Success criteria:

- Accepting an edit can reload the iframe without losing Reform state
- Revert remains available after rebuild
- No edit lifecycle state depends on iframe memory

### Phase 4. Replace proxy assumptions

- Reduce or remove HTML injection dependency in `proxy-server.mjs`
- Decide whether the proxy still exists only for convenience or is no longer needed

Success criteria:

- Reform works even if the target app reloads fully
- Main UX no longer depends on injected overlay ownership

### Phase 5. Cleanup

- Remove duplicated overlay logic no longer needed
- Keep only:
  - shell UI
  - frame bridge
  - agent session APIs

Success criteria:

- Clear separation between stable shell and disposable target frame
- Smaller runtime surface inside the target app

## Open Technical Questions

1. Same-origin assumptions

- If the iframe content is same-origin through the local proxy, direct DOM access is easier.
- If not, all inspection/highlight work must go through the bridge.

2. How the bridge gets loaded

- Keep the proxy and inject only the bridge script
- Or use browser automation / other bootstrapping to add the bridge

3. Where the shell should live

- Agent-served HTML is simpler and self-contained
- Dashboard integration may provide a better UI foundation

4. Frame sizing and coordinate mapping

- Parent shell needs clean translation between iframe-relative and viewport-relative coordinates if any parent-side visuals depend on them

5. Multi-frame apps

- If the target app itself uses nested iframes, the bridge model needs clear scope rules

## Risks

- Message protocol complexity can sprawl if the shell and bridge responsibilities are not kept narrow.
- Cross-origin behavior may limit direct DOM access if the proxy model changes.
- Moving the current overlay UI out of injected script form is a moderate refactor, not a small patch.

## Non-Goals

- Browser extension architecture
- DevTools panel integration
- Deep virtual patch previews inside the bundler

These may be valid future directions, but they are not the recommended next step.

## Recommended First Implementation Slice

Start with the smallest slice that proves the architecture:

1. Add a shell page with an iframe of the target app.
2. Keep the agent as the session source of truth.
3. Inject only a minimal frame bridge for hover/select/highlight.
4. Move edit proposal and apply/revert controls into the shell.

If that slice works, the rest of the current injected overlay can be migrated incrementally.
