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
