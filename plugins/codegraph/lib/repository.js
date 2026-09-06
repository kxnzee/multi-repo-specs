/** @fileoverview Repository-local setup owned by CodeGraph Plugin. */

import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const INDEX_EXCLUDE = ".codegraph/";
const SAFE_OPEN_FLAGS = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Pins the checked file before any I/O, including on Windows without O_NOFOLLOW. */
async function openCheckedExclude(target, expected, flags) {
  let handle;
  try {
    handle = await fs.open(target, flags | SAFE_OPEN_FLAGS);
    const actual = await handle.stat({ bigint: true });
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new Error("Git exclude replaced after validation");
    }
    return handle;
  } catch (cause) {
    if (handle) await handle.close();
    throw new Error("CODEGRAPH_GIT_EXCLUDE_UNSAFE", { cause });
  }
}

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

    const expected = await fs.lstat(excludePath, { bigint: true }).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!expected) {
      await fs.mkdir(path.dirname(excludePath), { recursive: true });
      // Do not follow a file/link introduced after ENOENT, including dangling links.
      const handle = await fs.open(excludePath, "wx").catch((cause) => {
        throw new Error("CODEGRAPH_GIT_EXCLUDE_UNSAFE", { cause });
      });
      try {
        await handle.writeFile(`${INDEX_EXCLUDE}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return;
    }
    if (!expected.isFile() || expected.isSymbolicLink()) {
      throw new Error("CODEGRAPH_GIT_EXCLUDE_UNSAFE");
    }
    const reader = await openCheckedExclude(excludePath, expected, constants.O_RDONLY);
    let source;
    try {
      source = await reader.readFile("utf8");
    } finally {
      await reader.close();
    }
    if (source.split(/\r?\n/u).includes(INDEX_EXCLUDE)) return;

    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const separator = source && !source.endsWith("\n") ? newline : "";
    const writer = await openCheckedExclude(excludePath, expected, constants.O_WRONLY | constants.O_APPEND);
    try {
      await writer.appendFile(`${separator}${INDEX_EXCLUDE}${newline}`, "utf8");
    } finally {
      await writer.close();
    }
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
