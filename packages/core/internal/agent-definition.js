/** @fileoverview Immutable definition одного поддерживаемого Agent. */

import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";
import { isPortableRelativePath } from "./path.js";
import { deepFreeze, hasExactKeys, isPlainObject } from "./value.js";

/** Завершает проверку Agent definition стабильной ошибкой. */
function invalid(message) {
  throw new Error(`AGENT_DEFINITION_INVALID: ${message}`);
}

/** Требует точный набор ключей plain object. */
function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) invalid(`${label} должен быть object`);
  if (!hasExactKeys(value, keys)) {
    invalid(`${label} должен содержать только ${[...keys].sort().join(", ")}`);
  }
}

/** Проверяет переносимый относительный path. */
function relative(value, label) {
  if (!isPortableRelativePath(value, { allowDot: false })) {
    invalid(`${label} должен быть безопасным относительным POSIX-путём`);
  }
  return value;
}

/** Definition не зависит от Template и не содержит lifecycle callbacks. */
export class AgentDefinition {
  #value;

  constructor(value = {}) {
    exactKeys(value, ["id", "name", "native", "openspec"], "Agent definition");
    exactKeys(
      value.openspec,
      ["adapter", "commandsDirectory", "generatedDirectory", "instructionsFile", "targetDirectory"],
      "openspec",
    );
    exactKeys(value.native, ["adapter", "executable", "manifest", "scope"], "native");
    if (typeof value.id !== "string" || !CORE_PATTERNS.id.test(value.id)) {
      invalid("id должен быть в lowercase kebab-case");
    }
    if (typeof value.name !== "string" || !value.name.trim()) invalid("name должен быть непустым");
    if (typeof value.openspec.adapter !== "string" || !CORE_PATTERNS.id.test(value.openspec.adapter)) {
      invalid("openspec.adapter должен быть в lowercase kebab-case");
    }
    if (typeof value.native.executable !== "string" || !value.native.executable.trim()) {
      invalid("native.executable должен быть непустым");
    }
    if (!new Set(["local", "project"]).has(value.native.scope)) {
      invalid("native.scope должен быть local или project");
    }
    const generatedDirectory = relative(value.openspec.generatedDirectory, "generatedDirectory");
    const targetDirectory = relative(value.openspec.targetDirectory, "targetDirectory");
    if (
      generatedDirectory !== targetDirectory &&
      (generatedDirectory.startsWith(`${targetDirectory}/`) || targetDirectory.startsWith(`${generatedDirectory}/`))
    ) {
      invalid("generatedDirectory и targetDirectory не могут быть вложены друг в друга");
    }
    this.#value = deepFreeze({
      id: value.id,
      name: value.name.trim(),
      openSpecId: value.openspec.adapter,
      generatedDirectory,
      targetDirectory,
      commandsDirectory: relative(value.openspec.commandsDirectory, "commandsDirectory"),
      instructionsFile: relative(value.openspec.instructionsFile, "instructionsFile"),
      executable: value.native.executable.trim(),
      nativeAdapter: relative(value.native.adapter, "native.adapter"),
      scope: value.native.scope,
      manifest: relative(value.native.manifest, "manifest"),
    });
    Object.freeze(this);
  }

  get id() { return this.#value.id; }
  get name() { return this.#value.name; }
  get openSpecId() { return this.#value.openSpecId; }
  get generatedDirectory() { return this.#value.generatedDirectory; }
  get targetDirectory() { return this.#value.targetDirectory; }
  get commandsDirectory() { return this.#value.commandsDirectory; }
  get instructionsFile() { return this.#value.instructionsFile; }
  get executable() { return this.#value.executable; }
  get nativeAdapter() { return this.#value.nativeAdapter; }
  get scope() { return this.#value.scope; }
  get manifest() { return this.#value.manifest; }

  protects(relativePath) {
    const normalized = path.posix.normalize(relativePath);
    return [
      this.generatedDirectory,
      this.targetDirectory,
      this.instructionsFile,
    ].some((protectedPath) => (
      normalized === protectedPath || normalized.startsWith(`${protectedPath}/`)
    ));
  }

  snapshot() {
    return deepFreeze(globalThis.structuredClone(this.#value));
  }
}
