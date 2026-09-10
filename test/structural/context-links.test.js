/** @fileoverview Checks context links using disposable Markdown files. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditContextLinks } from "../../test-support/context-links.js";

test("context links reject external targets and broken anchors while keeping same-file links valid", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "context-links-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = path.join(root, "context");
  await fs.mkdir(context);
  const file = path.join(context, "index.md");
  const original = "# Context\n";
  await fs.writeFile(path.join(context, "domain.md"), "# Domain\n");
  const mutations = [
    ["EXTERNAL_LINK", "[external](https://example.invalid/policy)"],
    ["EXTERNAL_LINK", "![image](https://example.invalid/diagram.png)"],
    ["EXTERNAL_LINK", "[policy][outside]\n[outside]: https://example.invalid/policy"],
    ["EXTERNAL_LINK", '<img src="https://example.invalid/diagram.png">'],
    ["EXTERNAL_LINK", "[escape](../../implementation.json)"],
    ["EXTERNAL_LINK", "[encoded](%2e%2e/%2e%2e/implementation.json)"],
    ["BROKEN_LINK", "[missing](absent.md)"],
    ["BROKEN_ANCHOR", "[missing](domain.md#absent)"],
  ];
  for (const [expectedCode, addition] of mutations) {
    await fs.writeFile(file, `${original}\n${addition}\n`);
    assert.ok((await auditContextLinks(context)).diagnostics.some(({ code }) => code === expectedCode), addition);
  }
  await fs.writeFile(file, `${original}\n[local](#context)\n[domain](domain.md#domain)\n`);
  assert.deepEqual((await auditContextLinks(context)).diagnostics, []);

  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "policy.md"), "# Policy\n");
  await fs.symlink(outside, path.join(context, "outside-link"), "junction");
  await fs.writeFile(file, `${original}\n[escape](outside-link/policy.md)\n`);
  assert.ok((await auditContextLinks(context)).diagnostics.some(({ code }) => code === "EXTERNAL_LINK"));
});
