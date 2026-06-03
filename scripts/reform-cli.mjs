#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reformRoot = path.resolve(__dirname, "..");
const targetDir = process.cwd();

function parseArgs(argv) {
  const options = {
    url: "",
    cmd: "",
    test: "",
    goal: "Verify the primary user flow in the target app",
    noApproval: false,
    noBrowser: false,
    noOpen: false,
    agentPort: 8787,
    proxyPort: 5190,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--url" && next) {
      options.url = next;
      index += 1;
      continue;
    }

    if (token === "--cmd" && next) {
      options.cmd = next;
      index += 1;
      continue;
    }

    if (token === "--goal" && next) {
      options.goal = next;
      index += 1;
      continue;
    }

    if (token === "--test" && next) {
      options.test = next;
      index += 1;
      continue;
    }

    if (token === "--agent-port" && next) {
      options.agentPort = Number(next);
      index += 1;
      continue;
    }

    if (token === "--proxy-port" && next) {
      options.proxyPort = Number(next);
      index += 1;
      continue;
    }

    if (token === "--no-approval") {
      options.noApproval = true;
      continue;
    }

    if (token === "--no-browser") {
      options.noBrowser = true;
      continue;
    }

    if (token === "--no-open") {
      options.noOpen = true;
    }
  }

  return options;
}

function readPackageJson(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in ${projectRoot}`);
  }

  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

function detectPackageManager(projectRoot) {
  if (existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(path.join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(path.join(projectRoot, "bun.lockb")) || existsSync(path.join(projectRoot, "bun.lock"))) {
    return "bun";
  }

  return "npm";
}

function findFreePort(startPort) {
  let port = startPort;

  while (true) {
    const check = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const net = require('node:net');
          const server = net.createServer();
          server.once('error', () => process.exit(1));
          server.once('listening', () => server.close(() => process.exit(0)));
          server.listen(${port}, '127.0.0.1');
        `,
      ],
      { stdio: "ignore" },
    );

    if (check.status === 0) {
      return port;
    }

    port += 1;
  }
}

function detectFramework(packageJson) {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (deps.next) {
    return { name: "next", url: "http://127.0.0.1:3000" };
  }

  if (deps["@remix-run/react"]) {
    return { name: "remix", url: "http://127.0.0.1:3000" };
  }

  if (deps["react-scripts"]) {
    return { name: "react-scripts", url: "http://127.0.0.1:3000" };
  }

  if (deps.vite) {
    return { name: "vite", url: "http://127.0.0.1:5173" };
  }

  if (deps.astro) {
    return { name: "astro", url: "http://127.0.0.1:4321" };
  }

  return { name: "unknown", url: "http://127.0.0.1:3000" };
}

function withScriptRunner(packageManager, scriptName, extraArgs = []) {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: [scriptName, ...extraArgs] };
  }

  if (packageManager === "yarn") {
    return { command: "yarn", args: [scriptName, ...extraArgs] };
  }

  if (packageManager === "bun") {
    return { command: "bun", args: ["run", scriptName, ...extraArgs] };
  }

  return {
    command: "npm",
    args: ["run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])],
  };
}

function buildFrameworkArgs(frameworkName, port) {
  if (frameworkName === "vite" || frameworkName === "astro") {
    return ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  }

  if (frameworkName === "next") {
    return ["--hostname", "127.0.0.1", "--port", String(port)];
  }

  if (frameworkName === "react-scripts") {
    return [];
  }

  return [];
}

function detectDevCommand(projectRoot, packageJson, packageManager, frameworkName, port) {
  const frameworkArgs = buildFrameworkArgs(frameworkName, port);

  if (packageJson.scripts?.dev) {
    return withScriptRunner(packageManager, "dev", frameworkArgs);
  }

  if (packageJson.scripts?.start) {
    return withScriptRunner(packageManager, "start", frameworkArgs);
  }

  throw new Error("Could not find a dev or start script in the target project.");
}

function prefixStream(child, prefix) {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${prefix}] ${chunk}`);
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${prefix}] ${chunk}`);
  });
}

async function writeLaunchConfig(config) {
  const runtimePath = path.join(reformRoot, "agent/runtime");
  await mkdir(runtimePath, { recursive: true });
  await writeFile(path.join(runtimePath, "launch-config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function findTestDefinitions(projectRoot) {
  const testsDir = path.join(projectRoot, "tests");

  if (!existsSync(testsDir)) {
    return [];
  }

  const entries = await readdir(testsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({
      id: entry.name.replace(/\.json$/, ""),
      filePath: path.join(testsDir, entry.name),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function loadSelectedTest(projectRoot, selectedTestId) {
  const definitions = await findTestDefinitions(projectRoot);

  if (definitions.length === 0) {
    return null;
  }

  const chosen =
    definitions.find((entry) => entry.id === selectedTestId) ??
    definitions.find((entry) => entry.filePath === selectedTestId) ??
    definitions[0];

  if (selectedTestId && chosen.id !== selectedTestId && chosen.filePath !== selectedTestId) {
    const available = definitions.map((entry) => entry.id).join(", ");
    throw new Error(`Unknown test "${selectedTestId}". Available tests: ${available}`);
  }

  const raw = await readFile(chosen.filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.browserActions) || parsed.browserActions.length === 0) {
    throw new Error(`Test definition ${chosen.filePath} must include a non-empty browserActions array.`);
  }

  if (!Array.isArray(parsed.regressionChecks)) {
    throw new Error(`Test definition ${chosen.filePath} must include a regressionChecks array.`);
  }

  return {
    id: chosen.id,
    filePath: chosen.filePath,
    goal: typeof parsed.goal === "string" && parsed.goal.trim().length > 0 ? parsed.goal : null,
    browserActions: parsed.browserActions,
    regressionChecks: parsed.regressionChecks,
  };
}

async function buildTargetConfig(options, packageJson) {
  const framework = detectFramework(packageJson);
  const appUrl = options.url || framework.url;
  const selectedTest = await loadSelectedTest(targetDir, options.test);
  const goal = selectedTest?.goal ?? options.goal;

  return {
    goal,
    projectRoot: targetDir,
    appUrl,
    requireApproval: !options.noApproval,
    autoRetestLocal: true,
    maxRetries: 3,
    llmProvider: process.env.REFORM_LLM_PROVIDER || "openrouter",
    llmFallbackProvider: "zai",
    model: process.env.REFORM_LLM_MODEL || process.env.REFORM_OPENROUTER_MODEL || "x-ai/grok-4.20-beta",
    visualPlayback: {
      headless: false,
      showCursor: true,
      moveDurationMs: 350,
      actionDelayMs: 120,
    },
    browserActions:
      selectedTest?.browserActions ?? [
        { kind: "goto", target: "/" },
        { kind: "click", target: "button" },
      ],
    regressionChecks: selectedTest?.regressionChecks ?? [{ path: "/" }],
  };
}

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  prefixStream(child, options.label);
  return child;
}

async function waitForUrl(url, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep retrying until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = readPackageJson(targetDir);
  const packageManager = detectPackageManager(targetDir);
  const framework = detectFramework(packageJson);
  const initialTargetPort = findFreePort(
    new URL(options.url || framework.url).port
      ? Number(new URL(options.url || framework.url).port)
      : 3000,
  );
  const defaultDevCommand = detectDevCommand(
    targetDir,
    packageJson,
    packageManager,
    framework.name,
    initialTargetPort,
  );
  const targetConfig = await buildTargetConfig(options, packageJson);

  await writeLaunchConfig(targetConfig);

  const targetCommand = options.cmd
    ? { command: "bash", args: ["-lc", options.cmd] }
    : defaultDevCommand;

  const targetPort = initialTargetPort;
  const agentPort = findFreePort(options.agentPort);
  const proxyPort = findFreePort(options.proxyPort);

  targetConfig.appUrl = `http://127.0.0.1:${targetPort}`;
  await writeLaunchConfig(targetConfig);

  const agentUrl = `http://127.0.0.1:${agentPort}`;
  const overlayUrl = `${agentUrl}/overlay.js`;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  console.log(`Starting Reform for ${targetDir}`);
  console.log(`Target app: ${targetConfig.appUrl}`);
  console.log(`Agent API: ${agentUrl}`);
  console.log(`Proxy URL: ${proxyUrl}`);
  console.log(`Overlay script: ${overlayUrl}`);
  if (options.noBrowser) {
    console.log("Proxy mode enabled without auto-open. Open this URL in your browser:");
    console.log(`  ${proxyUrl}`);
  } else {
    console.log("Opening proxy URL with overlay injection...");
  }
  console.log("Press Ctrl+C to stop all services.");

  const children = [];

  const cleanup = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  children.push(
    spawnManaged(targetCommand.command, targetCommand.args, {
      cwd: targetDir,
      env: {
        ...process.env,
        PORT: String(targetPort),
      },
      label: "app",
    }),
  );

  children.push(
    spawnManaged("npm", ["run", "--workspace", "@reform/agent", "server"], {
      cwd: reformRoot,
      env: {
        ...process.env,
        REFORM_AGENT_PORT: String(agentPort),
        REFORM_APP_URL: targetConfig.appUrl,
      },
      label: "agent",
    }),
  );

  children.push(
    spawnManaged(
      process.execPath,
      [
        path.join(reformRoot, "scripts/proxy-server.mjs"),
        "--port",
        String(proxyPort),
        "--target-origin",
        targetConfig.appUrl,
        "--overlay-url",
        overlayUrl,
      ],
      {
        cwd: reformRoot,
        env: {
          ...process.env,
        },
        label: "proxy",
      },
    ),
  );

  if (!options.noBrowser && !options.noOpen) {
    await waitForUrl(targetConfig.appUrl);
    await waitForUrl(overlayUrl);
    await waitForUrl(proxyUrl);

    children.push(
      spawnManaged(
        "xdg-open",
        [proxyUrl],
        {
          cwd: reformRoot,
          env: {
            ...process.env,
          },
          label: "open",
        },
      ),
    );
  }

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
