/** @fileoverview Проверки безопасных переносимых путей внутри canonical root. */

import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";

/** Проверяет нахождение абсолютного пути внутри root. */
export function isContainedPath(root, candidate, { allowRoot = false } = {}) {
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Проверяет переносимый относительный POSIX path. */
export function isPortableRelativePath(value, { allowDot = true } = {}) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    CORE_PATTERNS.windowsDrivePrefix.test(value)
  ) {
    return false;
  }
  if (allowDot && value === ".") return true;
  return value !== "." && value.split("/").every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}
