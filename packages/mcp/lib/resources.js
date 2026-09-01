/** @fileoverview Read-only schema-aware resources for normative Store artifacts. */

import { parse } from "yaml";

const ROOT_FILES = Object.freeze(["openspec-orch.yaml", "openspec/config.yaml"]);
const STATIC_TREES = Object.freeze([
  Object.freeze({ root: "openspec/context", suffixes: new Set([".md", ".yaml", ".yml"]) }),
  Object.freeze({ root: "openspec/specs", names: new Set(["spec.md"]) }),
]);
const SCHEMA_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BUILTIN_OUTPUTS = Object.freeze({
  "spec-driven": Object.freeze(["proposal.md", "specs/**/*.md", "design.md", "tasks.md"]),
});

/** Maps allowlisted Store file types to MCP resource MIME types. */
function mimeType(relativePath) {
  if (relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml")) {
    return "application/yaml";
  }
  return "text/plain";
}

/** Encodes a Store-relative path without turning it into a filesystem URI. */
function resourceUri(storeId, relativePath) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `openspec-orch://store/${encodeURIComponent(storeId)}/${encodedPath}`;
}

/** Applies one exact basename or suffix allowlist rule. */
function matchesStatic(rule, name) {
  if (rule.names?.has(name)) return true;
  return [...(rule.suffixes ?? [])].some((suffix) => name.endsWith(suffix));
}

/** Walks only below one fixed allowlisted Store subtree. */
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

/** Recursively lists regular files below an already allowlisted Change root. */
async function walkChange(files, root, directory = root) {
  const found = (await files.listFiles(directory, { optional: true }))
    .map((name) => `${directory}/${name}`);
  for (const name of await files.listDirectories(directory, { optional: true })) {
    found.push(...await walkChange(files, root, `${directory}/${name}`));
  }
  return found;
}

/** Reads one YAML object and fails closed on malformed normative metadata. */
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
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${relativePath} должен содержать YAML object`);
  }
  return value;
}

/** Resolves the project default used only by legacy Changes without metadata. */
async function defaultSchema(files) {
  const config = await yamlObject(files, "openspec/config.yaml", { optional: true });
  if (!config) return "spec-driven";
  if (typeof config.schema !== "string" || !SCHEMA_ID.test(config.schema)) {
    throw new Error("MCP_RESOURCE_SCHEMA_INVALID: openspec/config.yaml.schema некорректна");
  }
  return config.schema;
}

/** Loads declared artifact outputs for one installed or built-in schema. */
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
    throw new Error(`MCP_RESOURCE_SCHEMA_INVALID: ${schemaPath}.artifacts должна быть array`);
  }
  return Object.freeze(schema.artifacts.map(({ generates }, index) => {
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

/** Matches the limited glob grammar accepted from schema artifact outputs. */
function outputMatches(pattern, relativePath) {
  const expected = pattern.split("/");
  const actual = relativePath.split("/");
  /** Matches remaining segments, where ** spans zero or more complete path segments. */
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

/** Lists active and archived Change roots without interpreting their process. */
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

/** Lists only outputs declared by each Change's own OpenSpec schema. */
async function changeArtifacts(files) {
  const fallback = await defaultSchema(files);
  const outputsBySchema = new Map();
  const found = [];
  for (const root of await changeRoots(files)) {
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

/** Exact allowlist behind resources/list and resources/read. */
export class StoreResourceService {
  #files;
  #storeId;

  constructor({ files, storeId }) {
    if (!files || typeof files.read !== "function" || typeof storeId !== "string") {
      throw new Error("MCP_RESOURCES_INVALID: требуются Files facade и storeId");
    }
    this.#files = files;
    this.#storeId = storeId;
    Object.freeze(this);
  }

  async list() {
    const paths = [];
    for (const relativePath of ROOT_FILES) {
      if (await this.#files.read(relativePath, { optional: true }) !== null) paths.push(relativePath);
    }
    for (const rule of STATIC_TREES) paths.push(...await walkStatic(this.#files, rule));
    paths.push(...await changeArtifacts(this.#files));
    return Object.freeze([...new Set(paths)].sort().map((relativePath) => Object.freeze({
      uri: resourceUri(this.#storeId, relativePath),
      name: relativePath,
      title: relativePath,
      mimeType: mimeType(relativePath),
      description: "Read-only normative artifact from the current OpenSpec Store",
    })));
  }

  async read(uri) {
    const resource = (await this.list()).find((candidate) => candidate.uri === uri);
    if (!resource) throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
    return Object.freeze({ ...resource, text: await this.#files.read(resource.name) });
  }
}
