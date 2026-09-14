/** @fileoverview Безопасное чтение materialized Store npm runtime. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CORE_SERVICE_PATHS } from "../configuration/constants.js";
import { lstatOrNull } from "../infrastructure/fs.js";
import { packageLockFingerprint, packageRuntimePath } from "./package-runtime-contract.js";
import { isContainedPath } from "../infrastructure/path.js";

export const RUNTIME_LOCK_MARKER = ".openspec-orch-lock.sha256";

/** Завершает проверку materialized runtime стабильной ошибкой. */
function invalid(message, options) {
  throw new Error(`PACKAGE_SUPPLY_INVALID: ${message}`, options);
}

/** Сообщает об отсутствующем или неполном materialized runtime. */
export function unavailable(message) {
  throw Object.assign(new Error(`PACKAGE_RUNTIME_UNAVAILABLE: ${message}`), {
    code: "PACKAGE_RUNTIME_UNAVAILABLE",
  });
}

/** Checks the complete Store-owned runtime directory chain. */
export async function inspectRuntimeRoot(checkoutRoot) {
  let current = checkoutRoot;
  let stat;
  for (const segment of CORE_SERVICE_PATHS.packageDirectory.split("/")) {
    current = path.join(current, segment);
    stat = await lstatOrNull(current);
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalid(`${CORE_SERVICE_PATHS.packageDirectory} содержит небезопасный каталог`);
    }
  }
  return stat;
}

/** Returns the marker path only when node_modules itself is safe. */
export async function runtimeLockMarker(runtimeRoot) {
  const modules = path.join(runtimeRoot, "node_modules");
  const stat = await lstatOrNull(modules);
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("node_modules небезопасен");
  return path.join(modules, RUNTIME_LOCK_MARKER);
}

/** Checks whether node_modules was materialized for this exact full lockfile. */
export async function matchesRuntimeLock(runtimeRoot, lockfile) {
  const marker = await runtimeLockMarker(runtimeRoot);
  if (!marker) return false;
  const stat = await lstatOrNull(marker);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink()) invalid("runtime lock marker небезопасен");
  return (await fs.readFile(marker, "utf8")).trim() === packageLockFingerprint(lockfile);
}

/** Invalidates the materialization marker before a runtime mutation. */
export async function invalidateRuntime(runtimeRoot) {
  const marker = await runtimeLockMarker(runtimeRoot);
  if (marker) await fs.rm(marker, { force: true });
}

/** Resolves one installed package root without allowing a symlink escape. */
export async function requireInstalledPackageRoot(runtimeRoot, packageName) {
  const target = packageRuntimePath(runtimeRoot, packageName);
  const stat = await lstatOrNull(target);
  if (!stat) unavailable(`${packageName}: выполните openspec-orch package sync`);
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid(`${packageName}: небезопасный package root`);
  const root = await fs.realpath(target);
  const canonicalRuntime = await fs.realpath(runtimeRoot);
  if (!isContainedPath(canonicalRuntime, root)) invalid(`${packageName}: package root вышел из runtime`);
  return root;
}

/** Inspects the installed package against its direct lockfile version. */
export async function inspectInstalledPackage(runtimeRoot, packageName, lockedVersion) {
  let packageRoot;
  try {
    packageRoot = await requireInstalledPackageRoot(runtimeRoot, packageName);
  } catch (error) {
    if (error?.code !== "PACKAGE_RUNTIME_UNAVAILABLE") throw error;
    return Object.freeze({ packageRoot: null, state: "missing", version: null });
  }
  const manifestPath = path.join(packageRoot, "package.json");
  const stat = await lstatOrNull(manifestPath);
  if (!stat?.isFile() || stat.isSymbolicLink()) invalid(`${packageName}: package.json отсутствует или небезопасен`);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    invalid(`${packageName}: package.json повреждён: ${error.message}`, { cause: error });
  }
  if (
    !manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
    manifest.name !== packageName || typeof manifest.version !== "string" || !manifest.version
  ) {
    invalid(`${packageName}: package.json не соответствует установленному package`);
  }
  return Object.freeze({
    packageRoot,
    state: typeof lockedVersion === "string" && manifest.version === lockedVersion ? "ready" : "stale",
    version: manifest.version,
  });
}
