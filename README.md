# Reform

Reform is an AI browser testing and self-repair tool for web apps.

It runs a browser flow from a natural-language goal, detects frontend failures,
patches likely code issues, rebuilds the app, and retests until the intended
user outcome passes or the retry limit is reached.

The current architecture supports:

- configurable target project roots and app URLs
- configurable browser flows for arbitrary projects
- OpenAI-driven dynamic file targeting and patch proposals
- approval-gated patch application in the dashboard
- live WebSocket logs
- semantic regression checks after the primary fix

## Repo Layout

- `dashboard/` - operator UI for live run status, repair timeline, and reports
- `agent/` - orchestration, diagnosis, patching, and verification logic
- `sandbox-app/` - demo web app with intentional bugs for controlled testing
- `shared/` - shared event and type definitions
- `tests/` - browser-flow definitions and test fixtures

## MVP Scope

Reform should support these bug classes first:

- broken click handlers
- wrong navigation routes
- incorrect form payloads

## Demo Flow

1. User enters a goal such as `Sign up and reach dashboard`.
2. Reform runs the flow in a browser.
3. It detects a failure from UI state, console errors, or network issues.
4. The affected UI area shows a visible repair state.
5. Reform patches code in the demo app.
6. The app rebuilds and the flow is rerun.
7. Reform outputs a verified report with the fix summary.

## Demo Startup

Run all demo services with:

```bash
npm run demo
```

This starts:

- sandbox app on `http://127.0.0.1:4173`
- agent API on `http://127.0.0.1:8787`
- dashboard on `http://127.0.0.1:5173`

Before running an LLM-backed repair, set:

```bash
export ZAI_API_KEY=...
```

Optional:

```bash
export ZAI_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
export REFORM_LLM_PROVIDER=zai
export REFORM_LLM_MODEL=glm-4.7
```

## Per-Project Launcher

Reform can now be launched from a target project directory.

First link the local CLI once from the Reform repo:

```bash
npm link
```

Then from any local web project:

```bash
cd /path/to/your-project
reform
```

You can also override detection:

```bash
reform --url http://127.0.0.1:3000
reform --cmd "pnpm dev"
reform --goal "Log in and reach dashboard"
reform --test 02-dashboard-navigation
reform --no-approval
reform --no-browser
reform --no-open
```

The launcher will:

- treat the current directory as the target project
- detect the package manager and dev command when possible
- write the target project config into Reform runtime state
- start the target app, Reform agent server, and dashboard together
- start a local proxy that injects the overlay into HTML responses
- open the proxied app URL automatically in your browser
- still expose an overlay script for manual fallback

If the target project contains `tests/*.json` files, Reform uses those
definitions to build the runtime browser flow and regression checks. You can
select a specific scenario with `--test <name>`.

By default the CLI starts:

- agent API on `http://127.0.0.1:8787`
- dashboard on `http://127.0.0.1:5180`

## In-App Overlay

By default, `reform` now starts a local proxy in front of your target app and
opens the proxied URL in your browser. The proxy injects the overlay
automatically into the page.

If you prefer manual control over browser opening, run:

```bash
reform --no-browser
```

Then open the printed proxy URL manually. If you want to skip browser opening
but still use the proxy, run:

```bash
reform --no-open
```

If you need the old manual script injection fallback, open DevTools on the
target app page and run:

```js
await import("http://127.0.0.1:8787/overlay.js");
```

If the CLI chose a different agent port, use the printed `Overlay script` URL.

The overlay gives you:

- live repair state on top of the target app
- target element highlighting
- patch approval and rejection controls
- live logs
- regression summaries

## Dashboard Flow

1. Start the demo stack with `npm run demo`.
2. Open the dashboard at `http://127.0.0.1:5173`.
3. Edit the JSON run config if you want to target a different local project or app URL.
4. Click `Run Repair`.
5. Review the proposed patch diff.
6. Approve or reject the patch in the dashboard.
7. Watch the semantic regression results after the retest.
