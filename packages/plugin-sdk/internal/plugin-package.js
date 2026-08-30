/** @fileoverview Доменная модель package.json одного Plugin package. */

import { PLUGIN_API_VERSION, PLUGIN_PATTERNS } from "./constants.js";
import { assertPlainObject } from "./validation.js";

/** Завершает проверку Package contract стабильной ошибкой. */
function invalid(message) {
  throw new Error(`PLUGIN_CONTRACT_INVALID: ${message}`);
}

/** Проверяет безопасный относительный ESM entrypoint. */
function assertPluginPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("./") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    invalid("openspecOrchestrator.plugin должен быть безопасным относительным POSIX path");
  }
}

/** Возвращает root export из строковой или conditional exports формы. */
function resolveRootExport(exportsValue) {
  if (typeof exportsValue === "string") return exportsValue;
  if (exportsValue && typeof exportsValue === "object" && !Array.isArray(exportsValue)) {
    const root = exportsValue["."];
    if (typeof root === "string") return root;
    if (root && typeof root === "object") return root.import ?? root.default;
  }
  return undefined;
}

/** Проверенная package identity и точка входа одного Plugin. */
export class PluginPackage {
  #name;
  #version;
  #entrypoint;

  /** @param {Record<string, unknown>} manifest Parsed package.json. */
  constructor(manifest) {
    assertPlainObject(manifest, "package.json", invalid);
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      invalid("package name обязателен");
    }
    if (
      typeof manifest.version !== "string" ||
      !PLUGIN_PATTERNS.exactSemanticVersion.test(manifest.version)
    ) {
      invalid("package version должна быть exact semantic version");
    }
    if (manifest.type !== "module") invalid("Plugin package должен использовать type=module");
    assertPlainObject(manifest.openspecOrchestrator, "openspecOrchestrator", invalid);
    const metadata = manifest.openspecOrchestrator;
    const metadataKeys = Object.keys(metadata);
    const nativeMetadata = metadataKeys.length === 2 && metadataKeys.includes("apiVersion") &&
      metadataKeys.includes("plugin");
    if (!nativeMetadata) invalid("openspecOrchestrator должен содержать apiVersion и plugin");
    if (metadata.apiVersion !== PLUGIN_API_VERSION) {
      invalid(`поддерживается только apiVersion=${PLUGIN_API_VERSION}`);
    }
    const entrypoint = metadata.plugin;
    assertPluginPath(entrypoint);
    if (resolveRootExport(manifest.exports) !== entrypoint) {
      invalid("package root export должен совпадать с openspecOrchestrator.plugin");
    }
    const sdkRange = manifest.peerDependencies?.["@openspec-orch/plugin-sdk"] ??
      manifest.dependencies?.["@openspec-orch/plugin-sdk"];
    if (typeof sdkRange !== "string" || sdkRange.length === 0) {
      invalid("Plugin package должен объявить @openspec-orch/plugin-sdk");
    }

    this.#name = manifest.name;
    this.#version = manifest.version;
    this.#entrypoint = entrypoint;
    Object.freeze(this);
  }

  get name() {
    return this.#name;
  }

  get version() {
    return this.#version;
  }

  get entrypoint() {
    return this.#entrypoint;
  }

  identity() {
    return Object.freeze({
      name: this.#name,
      version: this.#version,
      plugin: this.#entrypoint,
    });
  }
}
