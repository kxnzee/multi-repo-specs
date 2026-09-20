/** @fileoverview Link checks for the Markdown subset used by Template. */

import { promises as fs } from "node:fs";
import path from "node:path";

/** ATX-заголовок Markdown: от одного до шести символов # в начале строки. */
const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/gmu;
/** Inline Markdown link или image: извлекает destination из круглых скобок. */
const MARKDOWN_INLINE_DESTINATION = /!?\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu;
/** Reference-style Markdown link: извлекает destination из объявления `[id]: path`. */
const MARKDOWN_REFERENCE_DESTINATION = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gmu;
/** HTML-ссылка или ресурс: извлекает значение атрибута `href` либо `src`. */
const HTML_DESTINATION = /\b(?:href|src)=["']([^"']+)["']/gu;
/** Прямой HTTP(S) или file URL, указанный вне Markdown и HTML конструкции. */
const LITERAL_URL = /(?:https?:\/\/|file:\/\/)[^\s<>"')]+/gu;
/** URI scheme, абсолютный POSIX-путь или Windows-путь, запрещённый в local-only контексте. */
const EXTERNAL_DESTINATION = /^(?:[a-z][a-z\d+.-]*:|\/|\\)/iu;

/** Reads a deterministic tree without following directory symlinks. */
async function readContext(root, relative = "") {
  const files = new Map();
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [name, value] of await readContext(root, child)) files.set(name, value);
    } else if (entry.isFile()) {
      files.set(child, await fs.readFile(path.join(root, child), "utf8"));
    }
  }
  return files;
}

/** Checks containment both before and after resolving filesystem links. */
function isInside(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Отличает исходные материалы от устойчивых документов контекста. */
function isRawMaterial(root, target) {
  const [firstSegment] = path.relative(root, target).split(path.sep);
  return firstSegment === "_raw";
}

/** Computes heading anchors for the ordinary headings used by these fixtures. */
function headingAnchors(source) {
  const counts = new Map();
  return [...source.matchAll(MARKDOWN_HEADING)].map(([, heading]) => {
    const base = heading.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/gu, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

/** Извлекает поддерживаемые destinations из Markdown, HTML и прямых URL одного файла. */
function linkDestinations(source) {
  return new Set([
    ...[...source.matchAll(MARKDOWN_INLINE_DESTINATION)].map((match) => match[1]),
    ...[...source.matchAll(MARKDOWN_REFERENCE_DESTINATION)].map((match) => match[1]),
    ...[...source.matchAll(HTML_DESTINATION)].map((match) => match[1]),
    ...[...source.matchAll(LITERAL_URL)].map((match) => match[0]),
  ]);
}

/** Декодирует destination ссылки либо сообщает о некорректном percent-encoding. */
function decodeDestination(destination) {
  try {
    return { decoded: decodeURIComponent(destination) };
  } catch {
    return { code: "INVALID_LINK" };
  }
}

/** Синтаксически разрешает внутренний destination до перехода по filesystem links. */
function resolveInternalDestination(root, relative, decoded) {
  if (EXTERNAL_DESTINATION.test(decoded) || decoded.includes("\\")) {
    return { code: "EXTERNAL_LINK" };
  }
  const [targetPath, anchor] = decoded.split("#");
  const candidate = targetPath
    ? path.resolve(root, path.dirname(relative), targetPath)
    : path.join(root, relative);
  if (!isInside(root, candidate)) return { code: "EXTERNAL_LINK" };
  return { anchor, candidate };
}

/** Проверяет, что разрешённый target остаётся в контексте и содержит запрошенный anchor. */
async function validateTarget(root, candidate, anchor) {
  let target;
  try {
    target = await fs.realpath(candidate);
  } catch {
    return "BROKEN_LINK";
  }
  if (!isInside(root, target)) return "EXTERNAL_LINK";
  if (isRawMaterial(root, target)) return "RAW_MATERIAL_LINK";
  if (!(await fs.stat(target)).isFile()) return "NOT_A_FILE";
  if (anchor && !headingAnchors(await fs.readFile(target, "utf8")).includes(anchor)) {
    return "BROKEN_ANCHOR";
  }
  return null;
}

/** Формирует одну стабильную диагностику ссылки. */
function diagnostic(code, file, destination) {
  return { code, file, destination };
}

/** Checks file destinations and heading anchors; not a general Markdown parser. */
export async function auditContextLinks(root) {
  const realRoot = await fs.realpath(root);
  const files = await readContext(realRoot);
  const diagnostics = [];
  let checkedLinks = 0;
  for (const [relative, source] of files) {
    if (!relative.endsWith(".md")) continue;
    for (const destination of linkDestinations(source)) {
      checkedLinks += 1;
      const decoded = decodeDestination(destination);
      if (decoded.code) {
        diagnostics.push(diagnostic(decoded.code, relative, destination));
        continue;
      }
      const resolved = resolveInternalDestination(realRoot, relative, decoded.decoded);
      if (resolved.code) {
        diagnostics.push(diagnostic(resolved.code, relative, destination));
        continue;
      }
      if (!isRawMaterial(realRoot, path.join(realRoot, relative))
        && isRawMaterial(realRoot, resolved.candidate)) {
        diagnostics.push(diagnostic("RAW_MATERIAL_LINK", relative, destination));
        continue;
      }
      const code = await validateTarget(realRoot, resolved.candidate, resolved.anchor);
      if (code) diagnostics.push(diagnostic(code, relative, destination));
    }
  }
  return { files: files.size, checkedLinks, diagnostics };
}
