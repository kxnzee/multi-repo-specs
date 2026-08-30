/** @fileoverview Strict Repository Impact scope reader for Change Tracking. */

const HEADING = "## Repository Impact";
const HEADER = Object.freeze(["Repository", "Capabilities"]);
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Removes one optional Markdown code span from a machine identifier. */
function identifier(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^`([^`]+)`$/u);
  return (match ? match[1] : trimmed).trim();
}

/** Parses one exact two-column Markdown table row. */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = trimmed.slice(1, -1).split("|").map((value) => value.trim());
  return cells.length === 2 ? cells : null;
}

/** Creates one stable error for an unusable accepted Repository Impact. */
function invalid(changeId, message) {
  throw new Error(`REPOSITORY_IMPACT_INVALID: Change '${changeId}': ${message}`);
}

/**
 * Extracts the ordered unique Code Repository scope from a strict Proposal table.
 *
 * @param {string} source Proposal Markdown.
 * @param {string} changeId Change identity used in diagnostics.
 * @returns {readonly string[]} Repository IDs in declaration order.
 */
export function parseRepositoryImpactRepositories(source, changeId) {
  if (typeof source !== "string") invalid(changeId, "proposal.md должен быть текстом");
  const lines = source.split(/\r?\n/u);
  const headings = lines.flatMap((line, index) => line.trim() === HEADING ? [index] : []);
  if (headings.length !== 1) {
    invalid(changeId, headings.length === 0
      ? "отсутствует раздел Repository Impact"
      : "раздел Repository Impact повторяется");
  }

  let cursor = headings[0] + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  const header = tableCells(lines[cursor] ?? "");
  const separator = tableCells(lines[cursor + 1] ?? "");
  if (
    !header || header.some((cell, index) => cell !== HEADER[index]) ||
    !separator || separator.some((cell) => !/^:?-{3,}:?$/u.test(cell))
  ) {
    invalid(changeId, "ожидается таблица Repository | Capabilities");
  }

  cursor += 2;
  const repositories = [];
  const seen = new Set();
  const mappings = new Set();
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === "" || /^#{1,6}\s/u.test(line)) break;
    const cells = tableCells(line);
    const repositoryId = cells ? identifier(cells[0]) : "";
    const capabilities = cells
      ? cells[1].split(",").map(identifier).filter(Boolean)
      : [];
    if (!IDENTIFIER.test(repositoryId) || capabilities.length === 0) {
      invalid(changeId, `некорректная строка ${cursor + 1}`);
    }
    for (const capability of capabilities) {
      const mapping = `${repositoryId}\0${capability}`;
      if (mappings.has(mapping)) {
        invalid(changeId, `повторяется mapping '${repositoryId}' → '${capability}'`);
      }
      mappings.add(mapping);
    }
    if (!seen.has(repositoryId)) {
      seen.add(repositoryId);
      repositories.push(repositoryId);
    }
  }
  if (repositories.length === 0) invalid(changeId, "scope репозиториев пуст");
  return Object.freeze(repositories);
}
