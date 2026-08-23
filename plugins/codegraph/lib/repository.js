/** @fileoverview Repository-local setup owned by CodeGraph Plugin. */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const INDEX_EXCLUDE = ".codegraph/";

/** Represents the Code Repository prepared for a local CodeGraph index. */
export class CodeGraphRepository {
  #projectPath;

  constructor(projectPath = ".") {
    this.#projectPath = projectPath;
  }

  /** Keeps the generated index untracked without changing the Repository `.gitignore`. */
  async excludeGeneratedIndex() {
    const root = await fs.realpath(this.#projectPath);
    const { stdout } = await executeFile(
      "git",
      ["-C", root, "rev-parse", "--git-path", "info/exclude"],
      { encoding: "utf8" },
    );
    const reportedPath = stdout.trim();
    if (!reportedPath) throw new Error("CODEGRAPH_GIT_EXCLUDE_NOT_FOUND");
    const excludePath = path.isAbsolute(reportedPath)
      ? reportedPath
      : path.resolve(root, reportedPath);

    let source = "";
    try {
      const stat = await fs.lstat(excludePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("CODEGRAPH_GIT_EXCLUDE_UNSAFE");
      }
      source = await fs.readFile(excludePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (source.split(/\r?\n/u).includes(INDEX_EXCLUDE)) return;

    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const separator = source && !source.endsWith("\n") ? newline : "";
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.appendFile(excludePath, `${separator}${INDEX_EXCLUDE}${newline}`, "utf8");
  }
}

/** Interprets the native CodeGraph status as a Plugin repository state. */
export class CodeGraphRepositoryStatus {
  #details;
  #state;

  constructor(details) {
    if (typeof details !== "string") {
      throw new Error("CODEGRAPH_STATUS_INVALID: expected JSON string");
    }
    let value;
    try {
      value = JSON.parse(details);
    } catch (error) {
      throw new Error(`CODEGRAPH_STATUS_INVALID: ${error.message}`, { cause: error });
    }
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.initialized !== "boolean") {
      throw new Error("CODEGRAPH_STATUS_INVALID: initialized is missing");
    }
    this.#details = details;
    if (!value.initialized) {
      this.#state = "unavailable";
      Object.freeze(this);
      return;
    }
    const pending = value?.pendingChanges;
    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
      throw new Error("CODEGRAPH_STATUS_INVALID: pendingChanges is missing");
    }
    if (!value.index || typeof value.index !== "object" || Array.isArray(value.index)) {
      throw new Error("CODEGRAPH_STATUS_INVALID: index is missing");
    }
    if (value.index.state !== "complete") {
      this.#state = "unavailable";
      Object.freeze(this);
      return;
    }
    const changed = ["added", "modified", "removed"].some((key) => pending[key] > 0);
    this.#state = changed || value.worktreeMismatch || value.index.reindexRecommended
      ? "stale"
      : "ready";
    Object.freeze(this);
  }

  toPluginStatus() {
    return Object.freeze({ state: this.#state, details: this.#details });
  }
}
