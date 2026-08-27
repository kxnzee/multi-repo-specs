/** @fileoverview OpenSpec Graph Plugin Template intentionally delivers no Agent files. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const templateRoot = fileURLToPath(new URL("../../template/", import.meta.url));

test("OpenSpec Graph Plugin Template has no graph state or maintenance artifacts", async () => {
  const descriptor = parse(await fs.readFile(path.join(templateRoot, "template.yaml"), "utf8"));
  assert.deepEqual(descriptor, { agents: {} });
  await assert.rejects(fs.access(path.join(templateRoot, "openspec/graph.yaml")), { code: "ENOENT" });
  const skillEntries = await fs.readdir(path.join(templateRoot, "skills"), {
    recursive: true,
    withFileTypes: true,
  })
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  assert.deepEqual(skillEntries.filter((entry) => entry.isFile()), []);
});
