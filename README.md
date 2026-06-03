# Reform

Reform is an overlay-first AI browser testing and self-repair tool for web apps.

It launches against a target project, injects the Reform Overlay into the app,
runs UI and function flows, diagnoses failures, proposes patches, and retries
until the intended outcome is verified or the retry limit is reached.

The current architecture supports:

- configurable target project roots and app URLs
- configurable browser flows for arbitrary projects
- OpenAI-driven dynamic file targeting and patch proposals
- overlay-driven patch approval and rejection
- live WebSocket logs
- semantic regression checks after the primary fix

## Repo Layout

- `agent/` - orchestration, diagnosis, patching, and verification logic
- `shared/` - shared event and type definitions
- `scripts/` - CLI launcher, overlay proxy, and supporting runtime helpers
- `tests/` - flow definition examples for target projects

## Primary Flow

First link the local CLI once from the Reform repo:

```bash
npm link
```

Then from any local web project:

```bash
cd /path/to/your-project
reform
```

Before running an LLM-backed repair, set an API key:

```bash
export ZAI_API_KEY=...
```

Optional:

```bash
export ZAI_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
export REFORM_LLM_PROVIDER=zai
export REFORM_LLM_MODEL=glm-4.7
```

You can also override detection:

```bash
reform --url http://127.0.0.1:3000
reform --cmd "pnpm dev"
reform --goal "Open the account menu and verify the profile page loads"
reform --test 02-navigation-smoke
reform --no-approval
reform --no-browser
reform --no-open
```

The launcher will:

- treat the current directory as the target project
- detect the package manager and dev command when possible
- write the target project config into Reform runtime state
- start the target app, Reform agent server, and overlay proxy together
- start a local proxy that injects the overlay into HTML responses
- open the proxied app URL automatically in your browser
- still expose an overlay script for manual fallback

If the target project contains `tests/*.json` files, Reform uses those
definitions to build the runtime browser flow and regression checks. You can
select a specific scenario with `--test <name>`.

By default the CLI starts:

- agent API on `http://127.0.0.1:8787`
- overlay proxy on `http://127.0.0.1:5190`

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
- Edit Mode with hover/select plus auto/custom prompts
