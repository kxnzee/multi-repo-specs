/** @fileoverview Проверяемый контракт Store-local npm runtime. */

import { createHash } from "node:crypto";
import path from "node:path";

import * as z from "zod";

import { CORE_PATTERNS } from "../constants.js";

export const PACKAGE_KINDS = Object.freeze(["extensions", "plugins"]);

const PACKAGE_KIND_SET = new Set(PACKAGE_KINDS);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const PACKAGE_MAP_SCHEMA = z.record(
  z.string().regex(CORE_PATTERNS.id),
  z.string().regex(PACKAGE_NAME),
);
const PACKAGE_MANIFEST_SCHEMA = z.object({
  private: z.literal(true),
  dependencies: z.record(z.string().regex(PACKAGE_NAME), z.string().min(1)).default({}),
  openspecOrchestrator: z.object({
    extensions: PACKAGE_MAP_SCHEMA,
    plugins: PACKAGE_MAP_SCHEMA,
  }).passthrough(),
}).passthrough();
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Завершает проверку Store npm runtime стабильной ошибкой. */
function invalid(message, options) {
  throw new Error(`PACKAGE_SUPPLY_INVALID: ${message}`, options);
}

/** Проверяет domain key одного package. */
export function assertPackageRequest(kind, id) {
  if (!PACKAGE_KIND_SET.has(kind)) invalid(`неизвестный package kind '${kind ?? ""}'`);
  if (typeof id !== "string" || !CORE_PATTERNS.id.test(id)) {
    invalid(`некорректный package id '${id ?? ""}'`);
  }
}

/** Создаёт пустой private npm project manifest. */
export function emptyPackageManifest() {
  return {
    name: "openspec-orchestrator-packages",
    private: true,
    dependencies: {},
    openspecOrchestrator: { extensions: {}, plugins: {} },
  };
}

/** Проверяет принадлежащую Orchestrator часть package.json. */
export function assertPackageManifest(manifest) {
  const parsed = PACKAGE_MANIFEST_SCHEMA.safeParse(manifest);
  if (!parsed.success) invalid("package.json имеет несовместимый формат");
  const checked = parsed.data;
  for (const kind of PACKAGE_KINDS) {
    for (const [id, packageName] of Object.entries(checked.openspecOrchestrator[kind])) {
      if (!Object.hasOwn(checked.dependencies, packageName)) {
        invalid(`package.json mapping ${kind}/${id} не входит в dependencies`);
      }
    }
  }
  return checked;
}

/** Проверяет структуру lockfile, необходимую для работы runtime, и его зависимости. */
export function assertPackageLock(lockfile, manifest) {
  if (
    !lockfile || typeof lockfile !== "object" || Array.isArray(lockfile) ||
    !lockfile.packages ||
    typeof lockfile.packages !== "object" || Array.isArray(lockfile.packages) ||
    !lockfile.packages[""] || typeof lockfile.packages[""] !== "object" ||
    Array.isArray(lockfile.packages[""])
  ) {
    invalid("package-lock.json имеет несовместимый формат");
  }
  const lockedDependencies = lockfile.packages[""].dependencies ?? {};
  const entries = (value) => Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (
    typeof lockedDependencies !== "object" || Array.isArray(lockedDependencies) ||
    JSON.stringify(entries(lockedDependencies)) !== JSON.stringify(entries(manifest.dependencies))
  ) {
    invalid("package.json и package-lock.json содержат разные dependencies");
  }
  return lockfile;
}

/** Возвращает стандартный node_modules path package. */
export function packageRuntimePath(runtimeRoot, packageName) {
  if (!PACKAGE_NAME.test(packageName)) invalid(`некорректное npm package name '${packageName}'`);
  return path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
}

/** Возвращает lockfile entry прямого package. */
export function lockedPackage(lockfile, packageName) {
  const locked = lockfile?.packages?.[`node_modules/${packageName}`] ?? {};
  return locked && typeof locked === "object" && !Array.isArray(locked) ? locked : {};
}

/** Вычисляет стабильную ревизию полного npm lockfile. */
export function packageLockFingerprint(lockfile) {
  return createHash("sha256").update(JSON.stringify(lockfile)).digest("hex");
}

/** Классифицирует разрешённую npm-зависимость, не подменяя npm resolution. */
export function packageProvenance(requested, locked = {}) {
  if (requested.startsWith("file:")) return "local";
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/u.test(requested)) {
    return /#[0-9a-f]{40}$/iu.test(requested) || /[0-9a-f]{40}$/iu.test(locked.resolved ?? "")
      ? "git-commit"
      : "git-mutable";
  }
  if (/^https?:/u.test(requested)) return locked.integrity ? "tarball-integrity" : "tarball";
  return EXACT_VERSION.test(requested) ? "registry-exact" : "registry-mutable";
}

/** Сообщает, способна ли provenance измениться без изменения Store-файлов. */
export function hasMutablePackageProvenance(value) {
  return ["git-mutable", "local", "registry-mutable", "tarball"].includes(value);
}
