/** @fileoverview Verifies publishable tarballs without downloading npm dependencies. */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..", "..");
const distributionManifest = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const npmCli = process.env.npm_execpath;
if (typeof npmCli !== "string" || !path.isAbsolute(npmCli)) {
  throw new Error("PACKED_SMOKE_NPM_UNAVAILABLE: запустите через npm run test:pack");
}

/** Запускает npm текущей версии Node без shell-обёртки. */
function runNpm(args, options) {
  return execFileSync(process.execPath, [npmCli, ...args], { timeout: 120000, ...options });
}

/** Возвращает все publishable packages из workspace. */
async function publishableRoots() {
  const roots = ["."];
  for (const pattern of distributionManifest.workspaces) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`PACKED_SMOKE_WORKSPACE_PATTERN_UNSUPPORTED: ${pattern}`);
    }
    const parent = pattern.slice(0, -2);
    const entries = await fs.readdir(path.join(root, parent), { withFileTypes: true });
    roots.push(...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name)));
  }
  const publishable = [];
  for (const packageRoot of roots) {
    const manifestPath = path.join(root, packageRoot, "package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest.private !== true) publishable.push({ manifest, packageRoot });
  }
  return publishable.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

/** Собирает файловые цели из строкового или условного exports. */
function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((target) => exportTargets(target));
}

/** Возвращает entrypoints, которые должны попасть в tarball. */
function publishedEntrypoints(manifest) {
  const targets = ["package.json", ...exportTargets(manifest.exports)];
  if (typeof manifest.bin === "string") targets.push(manifest.bin);
  if (manifest.bin && typeof manifest.bin === "object") targets.push(...Object.values(manifest.bin));
  return [...new Set(targets.map((target) => target.replace(/^\.\//, "")))];
}

const packages = await publishableRoots();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-packed-artifacts-"));
const artifacts = path.join(temporary, "artifacts");
const npmEnvironment = {
  ...process.env,
  NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
};

try {
  await fs.mkdir(artifacts);
  for (const { manifest, packageRoot } of packages) {
    const output = runNpm(
      ["pack", path.resolve(root, packageRoot), "--json", "--pack-destination", artifacts],
      { cwd: root, encoding: "utf8", env: npmEnvironment },
    );
    const [{ filename, files }] = JSON.parse(output);
    const archive = path.join(artifacts, filename);
    await fs.access(archive);
    if (!Array.isArray(files)) {
      throw new Error(`PACKED_ARTIFACT_FILES_UNAVAILABLE: ${manifest.name}`);
    }
    const packedFiles = new Set(files.map(({ path: file }) => file));
    const missing = publishedEntrypoints(manifest).filter((file) => !packedFiles.has(file));
    if (missing.length > 0) {
      throw new Error(`PACKED_ARTIFACT_ENTRYPOINT_MISSING: ${manifest.name}: ${missing.join(", ")}`);
    }
  }
  console.log(`Packed artifact smoke passed for ${packages.length} packages without npm registry access.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
