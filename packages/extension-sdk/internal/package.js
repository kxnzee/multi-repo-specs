/** @fileoverview Package и descriptor contract standalone Extension. */

export const EXTENSION_API_VERSION = 1;
export const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Завершает package validation стабильной ошибкой. */
function invalid(message) {
  throw new Error(`EXTENSION_CONTRACT_INVALID: ${message}`);
}

/** Проверяет plain object. */
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} должен быть object`);
}

/** Проверяет точный набор полей. */
function exactKeys(value, keys, label) {
  plain(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} должен содержать только ${expected.join(", ")}`);
  }
}

/** Проверяет безопасный package-relative POSIX path. */
function relativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    invalid(`${label} должен быть безопасным относительным POSIX path`);
  }
}

export class ExtensionPackage {
  constructor(manifest) {
    plain(manifest, "package.json");
    if (typeof manifest.name !== "string" || !manifest.name) invalid("package name обязателен");
    if (typeof manifest.version !== "string" || !EXACT_VERSION.test(manifest.version)) {
      invalid("package version должна быть exact semantic version");
    }
    exactKeys(manifest.openspecOrchestrator, ["apiVersion", "extension"], "openspecOrchestrator");
    if (manifest.openspecOrchestrator.apiVersion !== EXTENSION_API_VERSION) {
      invalid(`поддерживается только apiVersion=${EXTENSION_API_VERSION}`);
    }
    if (manifest.openspecOrchestrator.extension !== "./extension.yaml") {
      invalid("openspecOrchestrator.extension должен быть ./extension.yaml");
    }
    this.name = manifest.name;
    this.version = manifest.version;
    this.descriptor = manifest.openspecOrchestrator.extension;
    Object.freeze(this);
  }

  identity() {
    return Object.freeze({
      name: this.name,
      version: this.version,
      extension: this.descriptor,
    });
  }
}

export class ExtensionDescriptor {
  constructor(descriptor, { agentIds } = {}) {
    exactKeys(descriptor, ["id", "manifests", "name",
      ...(descriptor && Object.hasOwn(descriptor, "targets") ? ["targets"] : [])], "extension descriptor");
    if (typeof descriptor.id !== "string" || !EXTENSION_ID_PATTERN.test(descriptor.id)) {
      invalid("id должен быть lowercase kebab-case");
    }
    if (typeof descriptor.name !== "string" || !descriptor.name.trim()) invalid("name обязателен");
    if (!Array.isArray(agentIds) || agentIds.length === 0 || new Set(agentIds).size !== agentIds.length) {
      invalid("agentIds должен содержать уникальные Agent IDs");
    }
    plain(descriptor.manifests, "manifests");
    const manifestAgentIds = Object.keys(descriptor.manifests);
    if (manifestAgentIds.length === 0) invalid("manifests должен содержать хотя бы один Agent");
    const unknownAgentId = manifestAgentIds.find((agentId) => !agentIds.includes(agentId));
    if (unknownAgentId) invalid(`manifests содержит неизвестный Agent '${unknownAgentId}'`);
    for (const [agentId, manifest] of Object.entries(descriptor.manifests)) {
      relativePath(manifest, `manifests.${agentId}`);
    }
    const targets = Object.hasOwn(descriptor, "targets") ? descriptor.targets : ["store"];
    if (!Array.isArray(targets) || targets.length === 0 ||
        targets.some((role) => !["store", "code"].includes(role)) ||
        new Set(targets).size !== targets.length) {
      invalid("targets должен содержать уникальные роли store/code");
    }
    this.targets = Object.freeze([...targets]);
    this.id = descriptor.id;
    this.name = descriptor.name.trim();
    this.manifests = Object.freeze({ ...descriptor.manifests });
    Object.freeze(this);
  }
}
