#!/usr/bin/env node

import { chromium } from "playwright";

function parseArgs(argv) {
  const options = {
    appUrl: "",
    overlayUrl: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--app-url" && next) {
      options.appUrl = next;
      index += 1;
      continue;
    }

    if (token === "--overlay-url" && next) {
      options.overlayUrl = next;
      index += 1;
    }
  }

  return options;
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

  if (!options.appUrl || !options.overlayUrl) {
    throw new Error("auto-overlay requires --app-url and --overlay-url");
  }

  await waitForUrl(options.appUrl);
  await waitForUrl(options.overlayUrl);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(options.appUrl, { waitUntil: "networkidle" });
  await page.addScriptTag({ url: options.overlayUrl });

  console.log(`Reform overlay injected into ${options.appUrl}`);

  const cleanup = async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void cleanup();
  });
  process.on("SIGTERM", () => {
    void cleanup();
  });

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
