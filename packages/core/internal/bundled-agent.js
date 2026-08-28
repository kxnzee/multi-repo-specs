/** @fileoverview Distribution-owned Agent definitions and catalog. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

import { AgentDefinition } from "./agent-definition.js";
import { AgentExtensionAdapter, isAgentExtensionAdapter } from "./agent-extension-adapter.js";
import { isContainedPath } from "./path.js";

/** Завершает проверку bundled Agent стабильной ошибкой. */
function invalid(message, options) {
  throw new Error(`BUNDLED_AGENT_INVALID: ${message}`, options);
}

/** Читает и проверяет immutable Agent definition из canonical root. */
async function loadDefinition(root, expectedId) {
  const descriptorPath = path.join(root, "agent.yaml");
  const descriptorStat = await fs.lstat(descriptorPath)
    .catch((cause) => invalid("agent.yaml отсутствует", { cause }));
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) {
    invalid("agent.yaml должен быть обычным файлом без symlink");
  }
  let value;
  try {
    value = parse(await fs.readFile(descriptorPath, "utf8"));
  } catch (cause) {
    invalid("agent.yaml содержит некорректный YAML", { cause });
  }
  let definition;
  try {
    definition = new AgentDefinition(value);
  } catch (cause) {
    invalid(cause.message, { cause });
  }
  if (expectedId !== undefined && definition.id !== expectedId) {
    invalid(`identity '${definition.id}' не совпадает с каталогом '${expectedId}'`);
  }
  return definition;
}

/** Загружает native adapter, не разрешая выход или symlink за Agent root. */
async function loadAdapter(root, relativePath) {
  const adapterPath = path.resolve(root, relativePath);
  if (!isContainedPath(root, adapterPath)) invalid("native.adapter выходит из Agent root");
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const segmentStat = await fs.lstat(current)
      .catch((cause) => invalid("native.adapter отсутствует", { cause }));
    if (segmentStat.isSymbolicLink()) invalid("native.adapter не должен проходить через symlink");
  }
  const canonicalAdapter = await fs.realpath(adapterPath);
  if (!isContainedPath(root, canonicalAdapter)) invalid("native.adapter выходит из Agent root");
  const adapterStat = await fs.stat(canonicalAdapter);
  if (!adapterStat.isFile() || adapterStat.isSymbolicLink()) {
    invalid("native.adapter должен быть обычным файлом без symlink");
  }
  const module = await import(pathToFileURL(canonicalAdapter).href)
    .catch((cause) => invalid("native.adapter не загружается", { cause }));
  return module.default;
}

/** Immutable catalog projection used by init selection. */
export class AgentCatalogEntry {
  constructor({ id, name } = {}) {
    if (typeof id !== "string" || typeof name !== "string") invalid("catalog entry требует id и name");
    this.id = id;
    this.name = name;
    Object.freeze(this);
  }
}

export class AgentCatalog {
  #entries;

  constructor(entries = []) {
    if (!Array.isArray(entries) || entries.some((entry) => !(entry instanceof AgentCatalogEntry))) {
      invalid("catalog entries должен содержать AgentCatalogEntry");
    }
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(sorted.map(({ id }) => id)).size !== sorted.length) invalid("повторяющийся agent-id");
    this.#entries = Object.freeze(sorted);
    Object.freeze(this);
  }

  get entries() { return this.#entries; }
}

/** Проверенный package одного каталога agents/<id>. */
export class BundledAgentPackage {
  #adapter;
  #definition;
  #root;

  constructor({ adapter, definition, root }) {
    if (
      !(definition instanceof AgentDefinition) ||
      typeof root !== "string" ||
      !isAgentExtensionAdapter(adapter)
    ) {
      invalid("constructor требует AgentDefinition, полный adapter и root");
    }
    this.#adapter = adapter;
    this.#definition = definition;
    this.#root = root;
    Object.freeze(this);
  }

  static async load(root, { expectedId } = {}) {
    if (typeof root !== "string" || !path.isAbsolute(root)) invalid("root должен быть абсолютным");
    const stat = await fs.lstat(root).catch((cause) => invalid("Agent root отсутствует", { cause }));
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("Agent root должен быть directory без symlink");
    const canonicalRoot = await fs.realpath(root);
    const definition = await loadDefinition(canonicalRoot, expectedId);
    const adapter = await loadAdapter(canonicalRoot, definition.nativeAdapter);
    return new BundledAgentPackage({ adapter, definition, root: canonicalRoot });
  }

  get adapter() { return this.#adapter; }
  get definition() { return this.#definition; }
  get id() { return this.#definition.id; }
  get name() { return this.#definition.name; }
  get root() { return this.#root; }
}

/** Provider выбирает Agent независимо от Template. */
export class BundledAgentProvider {
  #adapter;
  #catalog;
  #packages;

  constructor(packages = []) {
    if (!Array.isArray(packages) || packages.some((item) => !(item instanceof BundledAgentPackage))) {
      invalid("packages должен содержать BundledAgentPackage");
    }
    const sorted = [...packages].sort((left, right) => left.id.localeCompare(right.id));
    this.#packages = Object.freeze(sorted);
    this.#catalog = new AgentCatalog(sorted.map(({ id, name }) => new AgentCatalogEntry({ id, name })));
    this.#adapter = new AgentExtensionAdapter(sorted.map(({ adapter, definition }) => ({
      adapter,
      definition,
    })));
    Object.freeze(this);
  }

  get catalog() { return this.#catalog; }
  get adapter() { return this.#adapter; }

  resolve(agentId) {
    const item = this.#packages.find(({ id }) => id === agentId);
    if (!item) throw new Error(`AGENT_NOT_DISCOVERED: agent-id '${agentId ?? ""}' не найден`);
    return item.definition;
  }
}

export const bundledAgents = Object.freeze(new BundledAgentProvider());
