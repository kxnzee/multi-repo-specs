/** @fileoverview Read-only resources for normative Store artifacts. */

const ROOT_FILES = Object.freeze(["openspec-orch.yaml", "openspec/config.yaml"]);
const TREE_RULES = Object.freeze([
  Object.freeze({ root: "openspec/context", suffixes: new Set([".md", ".yaml", ".yml"]) }),
  Object.freeze({ root: "openspec/specs", names: new Set(["spec.md"]) }),
  Object.freeze({
    root: "openspec/changes",
    names: new Set(["intake.md", "proposal.md", "design.md", "tasks.md", "spec.md"]),
  }),
  Object.freeze({ root: "tracking/cycles", suffixes: new Set([".yaml", ".yml"]) }),
]);

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
function matches(rule, name) {
  if (rule.names?.has(name)) return true;
  return [...(rule.suffixes ?? [])].some((suffix) => name.endsWith(suffix));
}

/** Walks only below one fixed allowlisted Store subtree. */
async function walk(files, rule, directory = rule.root) {
  const found = [];
  for (const name of await files.listFiles(directory, { optional: true })) {
    if (matches(rule, name)) found.push(`${directory}/${name}`);
  }
  for (const name of await files.listDirectories(directory, { optional: true })) {
    found.push(...await walk(files, rule, `${directory}/${name}`));
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
    for (const rule of TREE_RULES) paths.push(...await walk(this.#files, rule));
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
