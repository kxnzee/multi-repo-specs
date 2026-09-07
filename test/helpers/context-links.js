/** @fileoverview Link checks for the Markdown subset used by Template. */

import { promises as fs } from "node:fs";
import path from "node:path";

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

/** Computes heading anchors for the ordinary headings used by these fixtures. */
function headingAnchors(source) {
  const counts = new Map();
  return [...source.matchAll(/^#{1,6}\s+(.+)$/gmu)].map(([, heading]) => {
    const base = heading.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/gu, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

/** Checks file destinations and heading anchors; not a general Markdown parser. */
export async function auditContextLinks(root) {
  const realRoot = await fs.realpath(root);
  const files = await readContext(realRoot);
  const diagnostics = [];
  let checkedLinks = 0;
  for (const [relative, source] of files) {
    if (!relative.endsWith(".md")) continue;
    const destinations = new Set([
      ...[...source.matchAll(/!?\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)].map((match) => match[1]),
      ...[...source.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gmu)].map((match) => match[1]),
      ...[...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/gu)].map((match) => match[1]),
      ...[...source.matchAll(/(?:https?:\/\/|file:\/\/)[^\s<>"')]+/gu)].map((match) => match[0]),
    ]);
    for (const destination of destinations) {
      checkedLinks += 1;
      let decoded;
      try {
        decoded = decodeURIComponent(destination);
      } catch {
        diagnostics.push({ code: "INVALID_LINK", file: relative, destination });
        continue;
      }
      if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/iu.test(decoded) || decoded.includes("\\")) {
        diagnostics.push({ code: "EXTERNAL_LINK", file: relative, destination });
        continue;
      }
      const [targetPath, anchor] = decoded.split("#");
      const candidate = targetPath
        ? path.resolve(realRoot, path.dirname(relative), targetPath)
        : path.join(realRoot, relative);
      if (!isInside(realRoot, candidate)) {
        diagnostics.push({ code: "EXTERNAL_LINK", file: relative, destination });
        continue;
      }
      let target;
      try {
        target = await fs.realpath(candidate);
      } catch {
        diagnostics.push({ code: "BROKEN_LINK", file: relative, destination });
        continue;
      }
      if (!isInside(realRoot, target)) {
        diagnostics.push({ code: "EXTERNAL_LINK", file: relative, destination });
      } else if (!(await fs.stat(target)).isFile()) {
        diagnostics.push({ code: "NOT_A_FILE", file: relative, destination });
      } else if (anchor && !headingAnchors(await fs.readFile(target, "utf8")).includes(anchor)) {
        diagnostics.push({ code: "BROKEN_ANCHOR", file: relative, destination });
      }
    }
  }
  return { files: files.size, checkedLinks, diagnostics };
}
