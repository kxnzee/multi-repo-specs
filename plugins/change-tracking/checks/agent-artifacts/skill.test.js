/** @fileoverview Structural contract of Change Tracking Agent artifacts. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const packageRoot = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

test("Change Tracking Apply context is a self-describing Plugin skill", async () => {
  const skillName = "change-tracking-apply-context";
  const relativePath = `extension/skills/${skillName}/SKILL.md`;
  const source = await fs.readFile(path.join(packageRoot, relativePath), "utf8");
  assert.equal(source.startsWith("---\n"), true, `${relativePath}: frontmatter is required`);
  const end = source.indexOf("\n---\n", 4);
  assert.notEqual(end, -1, `${relativePath}: frontmatter is not closed`);
  const metadata = parse(source.slice(4, end));
  assert.equal(metadata.name, skillName);
  assert.equal(typeof metadata.description, "string");
  assert.equal(metadata.description.trim().length > 0, true);
  assert.equal(source.slice(end + 5).trim().length > 0, true, `${relativePath}: body is empty`);
});
