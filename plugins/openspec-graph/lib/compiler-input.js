/** @fileoverview Store traversal and strict OpenSpec input parsing for graph compilation. */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  isMap,
  isSeq,
  LineCounter,
  parse as parseYaml,
  parseDocument,
} from "yaml";

import { diagnostic, fatal, source as graphSource } from "./report.js";

/** Lists ordinary spec.md files below a Store-relative directory. */
export async function specFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  let stat;
  try {
    stat = await fs.lstat(absoluteRoot);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fatal(`${relativeRoot} must be an ordinary directory`);
  }
  const found = [];
  /** Visits one ordinary directory in stable name order. */
  async function visit(absoluteDirectory, relativeDirectory) {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) fatal(`${relativePath} must not be a symlink`);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else if (entry.isFile() && entry.name === "spec.md") found.push(relativePath);
    }
  }
  await visit(absoluteRoot, relativeRoot);
  return found;
}

/** Lists immediate ordinary child directories in stable name order. */
export async function ordinaryDirectories(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  let stat;
  try {
    stat = await fs.lstat(absoluteRoot);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fatal(`${relativeRoot} must be an ordinary directory`);
  }
  const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const directories = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isSymbolicLink()) fatal(`${relativePath} must not be a symlink`);
    if (entry.isDirectory()) directories.push(entry.name);
  }
  return directories;
}

/** Reads one optional ordinary Store file. */
export async function readOptionalFile(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fatal(`${relativePath} must be an ordinary file`);
  }
  return fs.readFile(absolutePath, "utf8");
}

/** Returns the capability path represented by one spec file. */
export function capabilityFrom(file, marker) {
  const prefix = `${marker}/`;
  if (!file.startsWith(prefix) || !file.endsWith("/spec.md")) {
    fatal(`cannot derive capability from ${file}`);
  }
  const capability = file.slice(prefix.length, -"/spec.md".length);
  if (!capability || capability.split("/").some((segment) => !segment)) {
    fatal(`invalid capability path in ${file}`);
  }
  return capability;
}

/** Normalizes an archived OpenSpec directory to its original Change ID. */
export function archivedChangeId(directory) {
  return directory.replace(/^\d{4}-\d{2}-\d{2}-/u, "");
}

/** Resolves exact repository declaration lines from the Orchestrator config when available. */
export async function repositorySources(root, repositoryIds) {
  const locations = new Map(repositoryIds.map((repositoryId) => [
    repositoryId,
    graphSource("openspec-orch.yaml", 1, `repositories.${repositoryId}`),
  ]));
  const config = await readOptionalFile(root, "openspec-orch.yaml");
  if (config === null) return locations;
  const lineCounter = new LineCounter();
  const document = parseDocument(config, { lineCounter });
  if (document.errors.length > 0) return locations;
  const repositories = document.get("repositories", true);
  if (!isSeq(repositories)) return locations;
  for (const [index, repository] of repositories.items.entries()) {
    if (!isMap(repository)) continue;
    const idNode = repository.get("id", true);
    const repositoryId = idNode?.value;
    const offset = idNode?.range?.[0] ?? repository.range?.[0];
    if (!locations.has(repositoryId) || !Number.isInteger(offset)) continue;
    locations.set(repositoryId, graphSource(
      "openspec-orch.yaml",
      lineCounter.linePos(offset).line,
      `repositories[${index}].id`,
    ));
  }
  return locations;
}

/** Removes one Markdown code span used to delimit machine identifiers. */
function identifier(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^`([^`]+)`$/u);
  return (match ? match[1] : trimmed).trim();
}

/** Parses one two-column Markdown table row. */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = trimmed.slice(1, -1).split("|").map((value) => value.trim());
  return cells.length === 2 ? cells : null;
}

/** Parses the strict Repository Impact mapping from one Change proposal. */
export function parseRepositoryImpact(source, file, changeId) {
  const lines = source.split(/\r?\n/u);
  const headings = lines.flatMap((line, index) => (
    line.trim() === "## Repository Impact" ? [index] : []
  ));
  if (headings.length === 0) return { present: false, entries: [], diagnostics: [] };
  const diagnostics = [];
  if (headings.length > 1) {
    diagnostics.push(diagnostic(
      "REPOSITORY_IMPACT_DUPLICATE_SECTION",
      "error",
      `Change '${changeId}' contains more than one Repository Impact section`,
      { source: graphSource(file, headings[1] + 1, "repository-impact") },
    ));
    return { present: true, entries: [], diagnostics };
  }
  let cursor = headings[0] + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  const header = tableCells(lines[cursor] ?? "");
  const separator = tableCells(lines[cursor + 1] ?? "");
  if (
    header?.[0] !== "Repository"
    || header?.[1] !== "Capabilities"
    || !separator
    || separator.some((cell) => !/^:?-{3,}:?$/u.test(cell))
  ) {
    diagnostics.push(diagnostic(
      "REPOSITORY_IMPACT_TABLE_INVALID",
      "error",
      "Repository Impact must be a two-column Repository | Capabilities table",
      { source: graphSource(file, cursor + 1, "repository-impact") },
    ));
    return { present: true, entries: [], diagnostics };
  }
  cursor += 2;
  const entries = [];
  const declarations = new Set();
  let rowIndex = 0;
  for (; cursor < lines.length; cursor += 1, rowIndex += 1) {
    const line = lines[cursor];
    if (line.trim() === "" || /^#{1,6}\s/u.test(line)) break;
    const cells = tableCells(line);
    const repositoryId = cells ? identifier(cells[0]) : "";
    const capabilityIds = cells
      ? cells[1].split(",").map(identifier).filter(Boolean)
      : [];
    const rowSource = graphSource(file, cursor + 1, `repository-impact[${rowIndex}]`);
    if (!cells || !repositoryId || capabilityIds.length === 0) {
      diagnostics.push(diagnostic(
        "REPOSITORY_IMPACT_ROW_INVALID",
        "error",
        `Invalid Repository Impact row in Change '${changeId}'`,
        { source: rowSource },
      ));
      continue;
    }
    const capabilities = [];
    for (const [capabilityIndex, capabilityId] of capabilityIds.entries()) {
      const capabilitySource = graphSource(
        file,
        cursor + 1,
        `repository-impact[${rowIndex}].capabilities[${capabilityIndex}]`,
      );
      const declaration = `${repositoryId}\0${capabilityId}`;
      if (declarations.has(declaration)) {
        diagnostics.push(diagnostic(
          "REPOSITORY_IMPACT_DUPLICATE_MAPPING",
          "error",
          `Duplicate Repository Impact mapping '${repositoryId}' → '${capabilityId}'`,
          { source: capabilitySource },
        ));
        continue;
      }
      declarations.add(declaration);
      capabilities.push({ id: capabilityId, source: capabilitySource });
    }
    if (capabilities.length > 0) {
      entries.push({
        repositoryId,
        source: graphSource(file, cursor + 1, `repository-impact[${rowIndex}].repository`),
        capabilities,
      });
    }
  }
  if (entries.length === 0 && diagnostics.length === 0) {
    diagnostics.push(diagnostic(
      "REPOSITORY_IMPACT_EMPTY",
      "error",
      `Repository Impact in Change '${changeId}' contains no mappings`,
      { source: graphSource(file, headings[0] + 1, "repository-impact") },
    ));
  }
  return { present: true, entries, diagnostics };
}

/** Reads the native skip_specs marker without making it a graph-specific artifact. */
export async function changeMetadata(root, changePath, changeNodeId) {
  const file = `${changePath}/.openspec.yaml`;
  const source = await readOptionalFile(root, file);
  if (source === null) return { skipSpecs: false, diagnostics: [] };
  let document;
  try {
    document = parseYaml(source);
  } catch (error) {
    return {
      skipSpecs: false,
      diagnostics: [diagnostic(
        "CHANGE_METADATA_INVALID",
        "error",
        `${file}: ${error.message}`,
        {
          elements: [changeNodeId],
          source: graphSource(file, 1, "document"),
        },
      )],
    };
  }
  return { skipSpecs: document?.skip_specs === true, diagnostics: [] };
}
