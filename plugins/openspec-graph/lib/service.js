/** @fileoverview Store-scoped graph lifecycle through public PluginContext facades. */

import process from "node:process";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(new URL("../bin/openspec-graph.js", import.meta.url));

/** Parses launcher JSON without accepting malformed or partial graphs. */
function parseGraph(source) {
  let graph;
  try {
    graph = JSON.parse(source);
  } catch (error) {
    throw new Error(`OPENSPEC_GRAPH_OUTPUT_INVALID: ${error.message}`, { cause: error });
  }
  if (
    graph?.graph_version !== 1 ||
    typeof graph.source_digest !== "string" ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    throw new Error("OPENSPEC_GRAPH_OUTPUT_INVALID: incomplete graph document");
  }
  return graph;
}

/** Owns deterministic graph build, persistence and freshness checks. */
export class OpenSpecGraphService {
  #context;

  constructor(context) {
    this.#context = context;
    Object.freeze(this);
  }

  /** Validates OpenSpec before replacing the last known-good graph. */
  async build() {
    await this.#context.process.run(
      "openspec",
      ["validate", "--all", "--strict", "--no-interactive", "--json"],
    );
    const graph = await this.#project();
    await this.#context.storage.write(graph);
    return graph;
  }

  /** Returns Plugin repository status without changing Store or Plugin state. */
  async status() {
    const stored = await this.#context.storage.read();
    if (!stored) {
      return Object.freeze({
        state: "unavailable",
        authoritative: false,
        reason: "GRAPH_NOT_BUILT",
        stored_digest: null,
        current_digest: null,
        last_known_good_available: false,
        nodes: 0,
        edges: 0,
        next_command: "openspec-orch graph build",
        details: JSON.stringify({ reason: "GRAPH_NOT_BUILT" }),
      });
    }
    let current;
    try {
      current = await this.#project();
    } catch (error) {
      return Object.freeze({
        state: "invalid",
        authoritative: false,
        reason: "CURRENT_INPUTS_INVALID",
        stored_digest: stored.source_digest,
        current_digest: null,
        last_known_good_available: true,
        nodes: stored.nodes?.length ?? 0,
        edges: stored.edges?.length ?? 0,
        next_command: "openspec-orch graph build",
        details: JSON.stringify({
          reason: "CURRENT_INPUTS_INVALID",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
    const ready = stored.source_digest === current.source_digest;
    const detail = {
      ...(ready ? {} : { reason: "SOURCE_DIGEST_CHANGED" }),
      stored_digest: stored.source_digest,
      current_digest: current.source_digest,
      nodes: stored.nodes?.length ?? 0,
      edges: stored.edges?.length ?? 0,
    };
    return Object.freeze({
      state: ready ? "ready" : "stale",
      authoritative: ready,
      reason: ready ? null : "SOURCE_DIGEST_CHANGED",
      stored_digest: stored.source_digest,
      current_digest: current.source_digest,
      last_known_good_available: true,
      nodes: stored.nodes?.length ?? 0,
      edges: stored.edges?.length ?? 0,
      next_command: ready ? null : "openspec-orch graph build",
      details: JSON.stringify(detail),
    });
  }

  /** Returns the graph only when it still matches all current projection inputs. */
  async readFresh() {
    const graph = await this.#context.storage.read();
    if (!graph) throw new Error("OPENSPEC_GRAPH_NOT_BUILT: run graph build");
    const current = await this.#project();
    if (graph.source_digest !== current.source_digest) {
      throw new Error("OPENSPEC_GRAPH_STALE: run graph build");
    }
    return graph;
  }

  async #project() {
    const repositories = this.#context.project.repositories
      .filter(({ role }) => role === "code")
      .map(({ id, role }) => ({ id, role }));
    const output = await this.#context.process.run(
      process.execPath,
      [
        launcher,
        "build",
        ".",
        "--store-id",
        this.#context.project.id,
        "--repositories-json",
        JSON.stringify(repositories),
      ],
    );
    return parseGraph(output);
  }

  static summary(graph) {
    return `${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
      `digest ${graph.source_digest.slice(0, 12)}`;
  }
}
