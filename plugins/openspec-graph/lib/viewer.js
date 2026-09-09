/** @fileoverview Loopback-only static viewer for a built graph document. */

import { promises as fs } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expandStoreGraph, scopedGraphId } from "./expanded-view.js";

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

/** Adds browser actions while keeping each Store's source routes separate. */
function appendSourceActions(config, actions, repositoryId, namespace = false) {
  const suffix = repositoryId === null ? "" : `?repository=${encodeURIComponent(repositoryId)}`;
  for (const [id, action] of actions.nodes) {
    const key = namespace ? scopedGraphId(repositoryId, id) : id;
    config.sources[key] = { ...action, preview_url: action.preview_url + suffix };
  }
  for (const [id, action] of actions.evidence) {
    const key = namespace ? `${repositoryId}::${id}` : id;
    config.evidence[key] = { ...action, preview_url: action.preview_url + suffix };
  }
}

/** Builds source lookup tables and reports unavailable attached Stores. */
function viewerConfiguration(sourceActions, repositoryId, linkedStores, teamViews) {
  const config = { sources: {}, evidence: {} };
  appendSourceActions(config, sourceActions, repositoryId);
  for (const team of teamViews) {
    if (!team.selected) continue;
    const actions = graphSources(team.selected.graph, { readSource: team.selected.readSource });
    appendSourceActions(config, actions, team.id, true);
  }
  config.navigation = repositoryId === null
    ? linkedStores.map(({ id }) => ({
      id,
      label: id,
      href: `/?repository=${encodeURIComponent(id)}`,
      error: teamViews.find((team) => team.id === id)?.error,
    }))
    : [{ label: "Back to parent Store", href: "/" }];
  return config;
}

/** Retains the source previews belonging to one viewer snapshot, including read errors. */
async function snapshotSources(graph, readSource) {
  if (!readSource) return readSource;
  const paths = new Set([...graphSources(graph, { readSource }).routes.values()].map(({ path }) => path));
  const sources = new Map();
  for (const path of paths) {
    try { sources.set(path, { text: await readSource(path) }); }
    catch (error) { sources.set(path, { error }); }
  }
  return async (path) => {
    const source = sources.get(path);
    if (!source) throw new Error("GRAPH_SOURCE_NOT_FOUND");
    if (source.error) throw source.error;
    return source.text;
  };
}

/** Starts a server that never binds outside loopback. */
export async function startGraphViewer(
  graph,
  {
    port = OPEN_SPEC_GRAPH_CONFIG.viewer.defaultPort,
    readSource,
    sourceRoot,
    linkedStores = [],
    loadRepository,
    createServer = http.createServer,
  } = {},
) {
  readSource = await snapshotSources(graph, readSource);
  const repositories = new Map();
  const loadSnapshot = (id) => {
    if (!repositories.has(id)) {
      repositories.set(id, Promise.resolve().then(() => loadRepository(id)).then(async (selected) => ({
        ...selected, readSource: await snapshotSources(selected.graph, selected.readSource),
      })).catch((error) => {
        repositories.delete(id);
        throw error;
      }));
    }
    return repositories.get(id);
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname;
      const repositoryId = url.searchParams.get("repository");
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method Not Allowed");
        return;
      }
      let selectedGraph = graph;
      let selectedRead = readSource;
      let selectedRoot = sourceRoot;
      const scopedRequest = ["/", "/graph.json", "/viewer-config.json", "/viewer-state.json"].includes(pathname)
        || pathname.startsWith("/source/");
      if (repositoryId !== null && scopedRequest) {
        if (!linkedStores.some(({ id }) => id === repositoryId) || !loadRepository) {
          response.writeHead(404);
          response.end("Unknown linked Store");
          return;
        }
        const selected = await loadSnapshot(repositoryId);
        selectedGraph = selected.graph;
        selectedRead = selected.readSource;
        selectedRoot = undefined;
      }
      const expanded = repositoryId === null ? [...new Set(url.searchParams.getAll("expand"))] : [];
      const teamViews = [];
      if (scopedRequest && expanded.some((id) => !linkedStores.some((team) => team.id === id))) {
        response.writeHead(404);
        response.end("Unknown linked Store");
        return;
      }
      if (scopedRequest && repositoryId === null && !pathname.startsWith("/source/")) {
        for (const id of expanded) {
          try {
            const selected = await loadSnapshot(id);
            selectedGraph = expandStoreGraph(selectedGraph, id, selected.graph);
            teamViews.push({ id, selected });
          } catch (error) {
            teamViews.push({ id, error: error.message });
          }
        }
      }
      // Source routes must use the original Store graph, never the composed graph.
      const sourceActions = graphSources(repositoryId === null ? graph : selectedGraph, {
        readSource: selectedRead,
        sourceRoot: selectedRoot,
      });
      if (pathname === "/graph.json") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(`${JSON.stringify(selectedGraph)}\n`);
        return;
      }
      if (pathname === "/viewer-config.json" || pathname === "/viewer-state.json") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        const config = viewerConfiguration(sourceActions, repositoryId, linkedStores, teamViews);
        response.end(JSON.stringify(pathname === "/viewer-state.json" ? { graph: selectedGraph, config } : config));
        return;
      }
      if (pathname.startsWith("/source/")) {
        const nodeId = decodeURIComponent(pathname.slice("/source/".length));
        const source = sourceActions.routes.get(nodeId);
        if (!source || !selectedRead) {
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
        response.end(await selectedRead(source.path));
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
      const message = error instanceof Error ? error.message : String(error);
      const escaped = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      response.writeHead(500, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(`<!doctype html><meta charset="utf-8"><h1>Не удалось открыть граф</h1><p>${escaped}</p><a href="/">Вернуться в основной Store</a>`);
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
