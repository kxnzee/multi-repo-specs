/** @fileoverview Кросс-платформенные filesystem fixtures для Core tests. */

import { promises as fs } from "node:fs";
import process from "node:process";

/** Создаёт directory link без требования Windows symlink privilege. */
export function createDirectoryLink(target, link) {
  return fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}
