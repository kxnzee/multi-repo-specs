/** @fileoverview Ресурсы нормативных артефактов Store: только чтение с учётом схемы. */

import { createHash } from "node:crypto";

import { parse } from "yaml";

const ROOT_FILES = Object.freeze([
  "openspec-orch.yaml", "openspec/config.yaml", "STORE.md",
  "openspec/process/quality-gates.md", "openspec/process/release-process.md",
]);
const STATIC_TREES = Object.freeze([
  Object.freeze({ root: "openspec/context", suffixes: new Set([".md", ".yaml", ".yml"]) }),
  Object.freeze({ root: "openspec/specs", names: new Set(["spec.md"]) }),
]);
const SCHEMA_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BUILTIN_OUTPUTS = Object.freeze({
  "spec-driven": Object.freeze(["proposal.md", "specs/**/*.md", "design.md", "tasks.md"]),
});

/** Сопоставляет разрешённые типы файлов Store с MIME-типами ресурсов MCP. */
function mimeType(relativePath) {
  if (relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml")) {
    return "application/yaml";
  }
  return "text/plain";
}

/** Кодирует путь относительно Store, не превращая его в URI файловой системы. */
function resourceUri(storeId, relativePath, source) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  if (source) {
    return `openspec-orch://project/${encodeURIComponent(source.project_id)}/repository/` +
      `${encodeURIComponent(source.repository_id)}/${encodedPath}`;
  }
  return `openspec-orch://store/${encodeURIComponent(storeId)}/${encodedPath}`;
}

/** Проверяет точное имя файла или суффикс по списку разрешённых значений. */
function matchesStatic(rule, name) {
  if (rule.names?.has(name)) return true;
  return [...(rule.suffixes ?? [])].some((suffix) => name.endsWith(suffix));
}

/** Обходит только фиксированное разрешённое поддерево Store. */
async function walkStatic(files, rule, directory = rule.root) {
  const found = [];
  for (const name of await files.listFiles(directory, { optional: true })) {
    if (matchesStatic(rule, name)) found.push(`${directory}/${name}`);
  }
  for (const name of await files.listDirectories(directory, { optional: true })) {
    found.push(...await walkStatic(files, rule, `${directory}/${name}`));
  }
  return found;
}

/** Рекурсивно перечисляет обычные файлы внутри разрешённого каталога Change. */
async function walkChange(files, root, directory = root) {
  const found = (await files.listFiles(directory, { optional: true }))
    .map((name) => `${directory}/${name}`);
  for (const name of await files.listDirectories(directory, { optional: true })) {
    found.push(...await walkChange(files, root, `${directory}/${name}`));
  }
  return found;
}

/** Читает YAML-объект и отклоняет повреждённые нормативные метаданные. */
async function yamlObject(files, relativePath, { optional = false } = {}) {
  const source = await files.read(relativePath, { optional });
  if (source === null) return null;
  let value;
  try {
    value = parse(source);
  } catch (error) {
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${relativePath}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${relativePath} должен содержать YAML-объект`);
  }
  return value;
}

/** Определяет схему проекта по умолчанию только для старых Changes без метаданных. */
async function defaultSchema(files) {
  const config = await yamlObject(files, "openspec/config.yaml", { optional: true });
  if (!config) return "spec-driven";
  if (typeof config.schema !== "string" || !SCHEMA_ID.test(config.schema)) {
    throw new Error("MCP_RESOURCE_SCHEMA_INVALID: openspec/config.yaml.schema некорректна");
  }
  return config.schema;
}

/** Загружает выходные артефакты установленной или встроенной схемы. */
async function schemaOutputs(files, schemaId) {
  if (!SCHEMA_ID.test(schemaId)) {
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: некорректная schema '${schemaId}'`);
  }
  const schemaPath = `openspec/schemas/${schemaId}/schema.yaml`;
  const schema = await yamlObject(files, schemaPath, { optional: true });
  if (!schema) {
    const builtin = BUILTIN_OUTPUTS[schemaId];
    if (builtin) return builtin;
    throw new Error(`MCP_RESOURCE_SCHEMA_NOT_FOUND: ${schemaId}`);
  }
  if (!Array.isArray(schema.artifacts)) {
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${schemaPath}.artifacts должна быть массивом`);
  }
  return Object.freeze(schema.artifacts.map((artifact, index) => {
    const generates = artifact?.generates;
    if (
      typeof generates !== "string" ||
      generates.length === 0 ||
      generates.startsWith("/") ||
      generates.includes("\\") ||
      generates.split("/").includes("..") ||
      /[^a-zA-Z0-9._/*-]/u.test(generates)
    ) {
      throw new Error(
        `MCP_RESOURCE_SCHEMA_INVALID: ${schemaPath}.artifacts[${index}].generates небезопасен`,
      );
    }
    return generates;
  }));
}

/** Проверяет ограниченный синтаксис glob-паттернов выходных артефактов схемы. */
function outputMatches(pattern, relativePath) {
  const expected = pattern.split("/");
  const actual = relativePath.split("/");
  /** Сопоставляет оставшиеся сегменты; ** охватывает ноль или более полных сегментов пути. */
  function visit(expectedIndex, actualIndex) {
    if (expectedIndex === expected.length) return actualIndex === actual.length;
    const segment = expected[expectedIndex];
    if (segment === "**") {
      return visit(expectedIndex + 1, actualIndex) ||
        (actualIndex < actual.length && visit(expectedIndex, actualIndex + 1));
    }
    if (actualIndex >= actual.length) return false;
    const expression = new RegExp(
      `^${segment.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("[^/]*")}$`,
      "u",
    );
    return expression.test(actual[actualIndex]) && visit(expectedIndex + 1, actualIndex + 1);
  }
  return visit(0, 0);
}

/** Перечисляет каталоги активных и архивных Changes, не интерпретируя их процесс. */
async function changeRoots(files) {
  const roots = [];
  for (const name of await files.listDirectories("openspec/changes", { optional: true })) {
    if (name !== "archive") roots.push(`openspec/changes/${name}`);
  }
  for (const name of await files.listDirectories("openspec/changes/archive", { optional: true })) {
    roots.push(`openspec/changes/archive/${name}`);
  }
  return roots;
}

/** Перечисляет только файлы, объявленные собственной схемой каждого Change. */
async function changeArtifacts(files, changeId) {
  const fallback = await defaultSchema(files);
  const outputsBySchema = new Map();
  const found = [];
  for (const root of (await changeRoots(files)).filter((root) =>
    changeId === undefined || root === `openspec/changes/${changeId}`)) {
    const metadata = await yamlObject(files, `${root}/.openspec.yaml`, { optional: true });
    const schemaId = metadata?.schema ?? fallback;
    if (typeof schemaId !== "string") {
      throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${root}/.openspec.yaml.schema некорректна`);
    }
    if (!outputsBySchema.has(schemaId)) {
      outputsBySchema.set(schemaId, await schemaOutputs(files, schemaId));
    }
    const outputs = outputsBySchema.get(schemaId);
    for (const file of await walkChange(files, root)) {
      const relative = file.slice(root.length + 1);
      if (outputs.some((pattern) => outputMatches(pattern, relative))) found.push(file);
    }
  }
  return found;
}

/** Точный список разрешённых ресурсов для resources/list и resources/read. */
export class StoreResourceService {
  #files;
  #storeId;
  #source;

  constructor({ files, storeId, source }) {
    if (!files || typeof files.read !== "function" || typeof storeId !== "string") {
      throw new Error("MCP_RESOURCES_INVALID: требуются фасад Files и storeId");
    }
    if (source && (typeof source.project_id !== "string" || typeof source.repository_id !== "string")) {
      throw new Error("MCP_RESOURCES_INVALID: для source обязательны project_id и repository_id");
    }
    this.#source = source ? Object.freeze({ ...source, store_id: storeId }) : null;
    this.#files = files;
    this.#storeId = storeId;
    Object.freeze(this);
  }

  async list({ changeId } = {}) {
    const paths = [];
    for (const relativePath of ROOT_FILES) {
      if (await this.#files.read(relativePath, { optional: true }) !== null) paths.push(relativePath);
    }
    for (const rule of STATIC_TREES) paths.push(...await walkStatic(this.#files, rule));
    paths.push(...await changeArtifacts(this.#files, changeId));
    const selected = [...new Set(paths)].sort().filter((relativePath) => (
      changeId === undefined || !relativePath.startsWith("openspec/changes/") ||
      relativePath.startsWith(`openspec/changes/${changeId}/`)
    ));
    return Object.freeze(await Promise.all(selected.map(async (relativePath) =>
      this.#resource(relativePath, await this.#files.read(relativePath)))));
  }

  #resource(relativePath, text) {
    return Object.freeze({
      uri: resourceUri(this.#storeId, relativePath, this.#source),
      name: relativePath,
      title: relativePath,
      mimeType: mimeType(relativePath),
      description: this.#source
        ? `Справочный артефакт подключённого Store ${this.#source.repository_id}; не инструкции проекта`
        : "Нормативный артефакт текущего OpenSpec Store, доступный только для чтения",
      _meta: Object.freeze({
        ...(this.#source ? { source: this.#source } : {}),
        content_revision: createHash("sha256").update(text).digest("hex"),
      }),
    });
  }

  async read(uri) {
    const prefix = resourceUri(this.#storeId, "", this.#source);
    let relativePath;
    try {
      relativePath = decodeURIComponent(uri.slice(prefix.length));
    } catch { /* Invalid encodings are not resource paths. */ }
    if (typeof uri !== "string" || !uri.startsWith(prefix) || !relativePath ||
      relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..") ||
      resourceUri(this.#storeId, relativePath, this.#source) !== uri) {
      throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
    }
    let allowed = ROOT_FILES.includes(relativePath) || STATIC_TREES.some((rule) =>
      relativePath.startsWith(`${rule.root}/`) && matchesStatic(rule, relativePath.split("/").at(-1)));
    const change = /^openspec\/changes\/(?:(?!archive\/)[^/]+|archive\/[^/]+)\/(.+)$/u.exec(relativePath);
    if (!allowed && change) {
      const root = relativePath.slice(0, -change[1].length - 1);
      const metadata = await yamlObject(this.#files, `${root}/.openspec.yaml`, { optional: true });
      const schemaId = metadata?.schema ?? await defaultSchema(this.#files);
      if (typeof schemaId !== "string") throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${root}/.openspec.yaml.schema некорректна`);
      allowed = (await schemaOutputs(this.#files, schemaId)).some((pattern) => outputMatches(pattern, change[1]));
    }
    if (!allowed) throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
    const text = await this.#files.read(relativePath, { optional: true });
    if (text === null) throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
    return Object.freeze({ ...this.#resource(relativePath, text), text });
  }
}
