#!/usr/bin/env node

import { createServer } from "node:http";
import http from "node:http";
import https from "node:https";

function parseArgs(argv) {
  const options = {
    port: 5190,
    targetOrigin: "",
    overlayUrl: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--port" && next) {
      options.port = Number(next);
      index += 1;
      continue;
    }

    if (token === "--target-origin" && next) {
      options.targetOrigin = next;
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

function isHtml(contentType) {
  return typeof contentType === "string" && contentType.includes("text/html");
}

function injectOverlay(html, overlayUrl) {
  const tag = `<script type="module" src="${overlayUrl}"></script>`;

  if (html.includes(tag)) {
    return html;
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", `${tag}</body>`);
  }

  return `${html}${tag}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.targetOrigin || !options.overlayUrl) {
    throw new Error("proxy-server requires --target-origin and --overlay-url");
  }

  const targetOrigin = options.targetOrigin.replace(/\/$/, "");
  const targetUrl = new URL(targetOrigin);
  const requestImpl = targetUrl.protocol === "https:" ? https : http;

  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end("Missing request URL");
      return;
    }

    try {
      const upstreamUrl = new URL(request.url, targetOrigin).toString();
      const method = request.method ?? "GET";
      const body =
        method === "GET" || method === "HEAD"
          ? undefined
          : await new Promise((resolve, reject) => {
              const chunks = [];
              request.on("data", (chunk) => chunks.push(chunk));
              request.on("end", () => resolve(Buffer.concat(chunks)));
              request.on("error", reject);
            });

      const upstream = await fetch(upstreamUrl, {
        method,
        headers: request.headers,
        body,
        redirect: "manual",
      });

      const headers = new Headers(upstream.headers);
      headers.delete("content-length");
      headers.delete("content-security-policy");
      headers.delete("content-security-policy-report-only");

      if (isHtml(headers.get("content-type"))) {
        const html = await upstream.text();
        const injected = injectOverlay(html, options.overlayUrl);
        response.writeHead(upstream.status, Object.fromEntries(headers.entries()));
        response.end(injected);
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, Object.fromEntries(headers.entries()));
      response.end(buffer);
    } catch (error) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Proxy error");
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url) {
      socket.destroy();
      return;
    }

    const upstreamUrl = new URL(request.url, targetOrigin);
    const upstreamRequest = requestImpl.request({
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
      method: request.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: request.headers,
    });

    upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n`;
      const headerLines = Object.entries(upstreamResponse.headers)
        .flatMap(([key, value]) => {
          if (Array.isArray(value)) {
            return value.map((entry) => `${key}: ${entry}\r\n`);
          }

          if (typeof value === "undefined") {
            return [];
          }

          return [`${key}: ${value}\r\n`];
        })
        .join("");

      socket.write(`${statusLine}${headerLines}\r\n`);

      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }

      if (upstreamHead && upstreamHead.length > 0) {
        socket.write(upstreamHead);
      }

      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });

    upstreamRequest.on("error", () => {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });

    upstreamRequest.end();
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`reform.proxy listening on http://127.0.0.1:${options.port}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
