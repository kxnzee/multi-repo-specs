/** @fileoverview Package-owned Delta operation heading configuration and parsing. */

import { parse as parseYaml } from "yaml";

import { OPEN_SPEC_GRAPH_CONFIG } from "./config.js";
import { readOptionalFile } from "./compiler-input.js";
import { diagnostic, GRAPH_REPORT_CONTRACT, source as graphSource } from "./report.js";

const { operationHeadings: DEFAULT_OPERATION_HEADINGS } = OPEN_SPEC_GRAPH_CONFIG;
const OPERATION_CONFIG_FILE = OPEN_SPEC_GRAPH_CONFIG.files.operationHeadings;
const { error: ERROR } = GRAPH_REPORT_CONTRACT.severity;

/** Normalizes harmless Unicode, case and whitespace differences in a complete heading. */
function normalizeOperationHeading(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Creates the package-owned canonical heading lookup used when no config exists. */
function defaultOperationHeadings() {
  return new Map(Object.entries(DEFAULT_OPERATION_HEADINGS).map(([operation, heading]) => [
    normalizeOperationHeading(heading),
    operation,
  ]));
}

/** Returns whether a parsed YAML value is a mapping-like object. */
function mapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Ignores only an explicitly empty operation section, independent of its schema. */
function hasOperationPayload(lines) {
  const content = lines.join("\n").replace(/<!--[\s\S]*?-->/gu, "").trim();
  return content.length > 0 && !/^none\.?$/iu.test(content);
}

/** Loads optional aliases without replacing the canonical OpenSpec operation headings. */
export async function operationHeadingConfig(root) {
  const headings = defaultOperationHeadings();
  const source = await readOptionalFile(root, OPERATION_CONFIG_FILE);
  if (source === null) return { headings, diagnostics: [] };

  const diagnostics = [];
  const invalid = (message) => diagnostics.push(diagnostic(
    "OPERATION_HEADINGS_CONFIG_INVALID",
    ERROR,
    `${OPERATION_CONFIG_FILE}: ${message}`,
    { source: graphSource(OPERATION_CONFIG_FILE, 1, "operation_headings") },
  ));
  let document;
  try {
    document = parseYaml(source);
  } catch (error) {
    invalid(error.message);
    return { headings, diagnostics };
  }
  if (!mapping(document)) {
    invalid("document must be a YAML mapping");
    return { headings, diagnostics };
  }
  const unknownFields = Object.keys(document)
    .filter((field) => !["version", "operation_headings"].includes(field));
  if (unknownFields.length > 0) invalid(`unknown fields: ${unknownFields.join(", ")}`);
  if (document.version !== 1) invalid("version must equal 1");
  if (!mapping(document.operation_headings)) {
    invalid("operation_headings must be a mapping");
    return { headings, diagnostics };
  }

  const configuredHeadings = new Map(headings);
  for (const [operation, aliases] of Object.entries(document.operation_headings)) {
    if (!Object.hasOwn(DEFAULT_OPERATION_HEADINGS, operation)) {
      invalid(`unknown canonical operation '${operation}'`);
      continue;
    }
    if (!Array.isArray(aliases) || aliases.length === 0) {
      invalid(`${operation} must contain a non-empty list of complete Markdown headings`);
      continue;
    }
    for (const alias of aliases) {
      if (
        typeof alias !== "string"
        || alias.includes("\n")
        || !/^#{1,6}\s+\S/u.test(alias.trim())
      ) {
        invalid(`${operation} contains an invalid complete Markdown heading`);
        continue;
      }
      const normalized = normalizeOperationHeading(alias);
      const existing = configuredHeadings.get(normalized);
      if (existing && existing !== operation) {
        invalid(`heading '${alias}' maps to both ${existing} and ${operation}`);
        continue;
      }
      configuredHeadings.set(normalized, operation);
    }
  }
  return {
    headings: diagnostics.length > 0 ? headings : configuredHeadings,
    diagnostics,
  };
}

/** Extracts unique canonical Delta operations from configured complete headings. */
export function parseDeltaOperations(source, headings = defaultOperationHeadings()) {
  const operations = [];
  const duplicates = [];
  const firstLines = new Map();
  const lines = source.split(/\r?\n/u);
  const sections = [];
  for (const [index, line] of lines.entries()) {
    const operation = headings.get(normalizeOperationHeading(line));
    if (!operation) continue;
    sections.push({ operation, index, line: index + 1 });
  }
  for (const [sectionIndex, section] of sections.entries()) {
    const nextIndex = sections[sectionIndex + 1]?.index ?? lines.length;
    if (!hasOperationPayload(lines.slice(section.index + 1, nextIndex))) {
      continue;
    }
    const { operation, line } = section;
    if (firstLines.has(operation)) {
      duplicates.push({ operation, line, firstLine: firstLines.get(operation) });
      continue;
    }
    firstLines.set(operation, line);
    operations.push({ operation, line });
  }
  return { operations, duplicates };
}
