/** @fileoverview Контракт параллельного workspace skeleton до Core cutover. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { ESLint } from "eslint";

/** Читает JSON manifest относительно корня repository. */
async function readManifest(relativePath) {
  return JSON.parse(await fs.readFile(path.resolve(relativePath), "utf8"));
}

test("root distribution keeps legacy public while registering final workspaces", async () => {
  const manifest = await readManifest("package.json");

  assert.deepEqual(manifest.workspaces, ["packages/*", "plugins/*"]);
  assert.deepEqual(manifest.bin, { "openspec-orch": "./src/bin/openspec-orch.js" });
  assert.equal(manifest.files.includes("bin"), false);
  assert.equal(manifest.files.includes("packages"), false);
});

test("Core and Plugin SDK expose only their package root", async () => {
  const core = await readManifest("packages/core/package.json");
  const sdk = await readManifest("packages/plugin-sdk/package.json");

  assert.deepEqual(core.exports, { ".": "./index.js" });
  assert.deepEqual(sdk.exports, {
    ".": "./index.js",
    "./testing": "./testing.js",
  });
  assert.equal(core.private, true);
  assert.equal(sdk.private, true);
  assert.equal(sdk.dependencies, undefined);
});

test("legacy and candidate entrypoints run independently", () => {
  const legacy = spawnSync(process.execPath, ["src/bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  const candidate = spawnSync(process.execPath, ["bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });

  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(candidate.status, 0, candidate.stderr);
  assert.match(legacy.stdout, /Cycle и Snapshot для multi-repo Change/);
  assert.match(candidate.stdout, /candidate runtime/);
  assert.notEqual(candidate.stdout, legacy.stdout);
});

test("ESLint enforces static Core, SDK and Plugin import boundaries", async () => {
  const eslint = new ESLint({ cwd: path.resolve(".") });
  const cases = [
    {
      filePath: path.resolve("plugins/example/index.js"),
      source: "import core from '../../packages/core/internal.js';\nvoid core;\n",
    },
    {
      filePath: path.resolve("packages/core/internal/example.js"),
      source: "import plugin from '../../../plugins/codegraph/index.js';\nvoid plugin;\n",
    },
    {
      filePath: path.resolve("packages/plugin-sdk/internal/example.js"),
      source: "import core from '../../core/internal.js';\nvoid core;\n",
    },
  ];

  for (const fixture of cases) {
    const [result] = await eslint.lintText(fixture.source, { filePath: fixture.filePath });
    assert.equal(
      result.messages.some(({ ruleId }) => ruleId === "no-restricted-imports"),
      true,
      fixture.filePath,
    );
  }

  for (const filePath of [
    path.resolve("packages/core/internal/sdk-consumer.js"),
    path.resolve("packages/plugin-sdk/test/self-reference.js"),
    path.resolve("plugins/example/index.js"),
  ]) {
    const [result] = await eslint.lintText(
      "import { definePlugin } from '@openspec-orch/plugin-sdk';\nvoid definePlugin;\n",
      { filePath },
    );
    assert.equal(
      result.messages.some(({ ruleId }) => ruleId === "no-restricted-imports"),
      false,
      filePath,
    );
  }
});
