/** @fileoverview Loopback-only static viewer for a built graph document. */

import { promises as fs } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OPEN_SPEC_GRAPH_CONFIG } from "./config.js";

const require = createRequire(import.meta.url);
const viewerRoot = fileURLToPath(new URL("../viewer/", import.meta.url));
const visNetworkRoot = path.dirname(require.resolve("vis-network/package.json"));
const assets = new Map([
  ["/", [path.join(viewerRoot, "index.html"), "text/html; charset=utf-8"]],
  ["/app.js", [path.join(viewerRoot, "app.js"), "text/javascript; charset=utf-8"]],
  ["/graph-query.js", [
    fileURLToPath(new URL("./query.js", import.meta.url)),
    "text/javascript; charset=utf-8",
  ]],
  ["/styles.css", [path.join(viewerRoot, "styles.css"), "text/css; charset=utf-8"]],
  ["/favicon.svg", [path.join(viewerRoot, "favicon.svg"), "image/svg+xml"]],
  ["/favicon.ico", [path.join(viewerRoot, "favicon.svg"), "image/svg+xml"]],
  ["/vendor/vis-network.min.js", [
    path.join(visNetworkRoot, "standalone/umd/vis-network.min.js"),
    "text/javascript; charset=utf-8",
  ]],
  ["/vendor/vis-network.min.css", [
    path.join(visNetworkRoot, "styles/vis-network.min.css"),
    "text/css; charset=utf-8",
  ]],
]);

/** Accepts only normalized Store-relative paths already allowlisted by the graph. */
function isSourcePath(value) {
  if (typeof value !== "string") return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && normalized !== "."
    && !path.posix.isAbsolute(normalized)
    && !normalized.startsWith("../")
    && !normalized.includes("/../");
}

/** Validates one structured provenance source. */
function evidenceReference(value) {
  if (
    !value
    || typeof value !== "object"
    || !isSourcePath(value.path)
    || !Number.isInteger(value.line)
    || value.line < 1
    || typeof value.field !== "string"
    || value.field.length === 0
  ) return undefined;
  return Object.freeze({ path: value.path, line: value.line, field: value.field });
}

/** Creates the stable browser lookup key for one source location. */
function evidenceKey(value) {
  return JSON.stringify([value.path, value.line, value.field]);
}

/** Builds one allowlisted browser action for a Store file. */
function sourceAction(relativePath, routeKey, root, line = 1) {
  const previewUrl = `/source/${encodeURIComponent(routeKey)}`;
  let ideUrl;
  if (root) {
    const absolute = path.resolve(root, relativePath);
    if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
      const uriPath = absolute.split(path.sep).join("/");
      ideUrl = `vscode://file/${encodeURI(uriPath)}:${line}`;
    }
  }
  return Object.freeze({
    path: relativePath,
    line,
    preview_url: previewUrl,
    ide_url: ideUrl,
  });
}

/** Builds browser-only actions for allowlisted graph source files. */
function graphSources(graph, { readSource, sourceRoot }) {
  if (readSource === undefined) {
    return Object.freeze({ nodes: new Map(), evidence: new Map(), routes: new Map() });
  }
  if (typeof readSource !== "function") throw new Error("readSource must be a function");
  if (sourceRoot !== undefined && !path.isAbsolute(sourceRoot)) {
    throw new Error("sourceRoot must be an absolute path");
  }
  const root = sourceRoot ? path.resolve(sourceRoot) : undefined;
  const nodes = new Map();
  const evidence = new Map();
  const routes = new Map();
  for (const node of graph.nodes) {
    if (!["master-spec", "delta-spec"].includes(node.type) || !isSourcePath(node.path)) continue;
    const action = sourceAction(node.path, node.id, root);
    nodes.set(node.id, action);
    routes.set(node.id, action);
  }
  for (const edge of graph.edges) {
    for (const location of edge.provenance ?? []) {
      const parsed = evidenceReference(location);
      if (!parsed) continue;
      const reference = evidenceKey(parsed);
      if (evidence.has(reference)) continue;
      const routeKey = `evidence:${reference}`;
      const action = sourceAction(parsed.path, routeKey, root, parsed.line);
      evidence.set(reference, action);
      routes.set(routeKey, action);
    }
  }
  for (const diagnostic of graph.diagnostics ?? []) {
    const parsed = evidenceReference(diagnostic.source);
    if (!parsed) continue;
    const { path: relativePath, line } = parsed;
    const reference = evidenceKey(parsed);
    if (evidence.has(reference)) continue;
    const routeKey = `evidence:${reference}`;
    const action = sourceAction(relativePath, routeKey, root, line);
    evidence.set(reference, action);
    routes.set(routeKey, action);
  }
  return Object.freeze({ nodes, evidence, routes });
}

/** Starts a server that never binds outside loopback. */
export async function startGraphViewer(
  graph,
  {
    port = OPEN_SPEC_GRAPH_CONFIG.viewer.defaultPort,
    readSource,
    sourceRoot,
    createServer = http.createServer,
  } = {},
) {
  const graphSource = `${JSON.stringify(graph)}\n`;
  const sourceActions = graphSources(graph, { readSource, sourceRoot });
  const viewerConfigSource = `${JSON.stringify({
    sources: Object.fromEntries(sourceActions.nodes),
    evidence: Object.fromEntries(sourceActions.evidence),
  })}\n`;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method Not Allowed");
        return;
      }
      if (pathname === "/graph.json") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(graphSource);
        return;
      }
      if (pathname === "/viewer-config.json") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(viewerConfigSource);
        return;
      }
      if (pathname.startsWith("/source/")) {
        const nodeId = decodeURIComponent(pathname.slice("/source/".length));
        const source = sourceActions.routes.get(nodeId);
        if (!source || !readSource) {
          response.writeHead(404);
          response.end("Not Found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(await readSource(source.path));
        return;
      }
      const asset = assets.get(pathname);
      if (!asset) {
        response.writeHead(404);
        response.end("Not Found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
      });
      response.end(await fs.readFile(asset[0]));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return Object.freeze({
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    ))),
    wait: () => new Promise((resolve) => server.once("close", resolve)),
  });
}
