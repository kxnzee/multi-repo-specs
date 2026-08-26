/** @fileoverview Контракт параллельного workspace skeleton до Core cutover. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";

/** Читает JSON manifest относительно корня repository. */
async function readManifest(relativePath) {
  return JSON.parse(await fs.readFile(path.resolve(relativePath), "utf8"));
}

test("root distribution exposes the candidate entrypoint and required runtime files", async () => {
  const manifest = await readManifest("package.json");

  assert.deepEqual(manifest.workspaces, ["packages/*", "plugins/*"]);
  assert.deepEqual(manifest.bin, { "openspec-orch": "./bin/openspec-orch.js" });
  assert.deepEqual(manifest.files, ["bin", "templates"]);
  assert.deepEqual(manifest.dependencies, {
    "@openspec-orch/core": "0.1.0",
    "@openspec-orch/plugin-change-tracking": "1.0.0",
    "@openspec-orch/plugin-codegraph": "1.0.0",
    "@openspec-orch/plugin-openspec-graph": "1.0.0",
  });
  assert.deepEqual(
    manifest.openspecOrchestrator.bundledPlugins,
    Object.keys(manifest.dependencies).filter((name) => name.startsWith("@openspec-orch/plugin-")),
  );
});

test("Core and Plugin SDK are independently publishable packages", async () => {
  const core = await readManifest("packages/core/package.json");
  const sdk = await readManifest("packages/plugin-sdk/package.json");

  assert.deepEqual(core.exports, { ".": "./index.js" });
  assert.deepEqual(sdk.exports, {
    ".": "./index.js",
    "./testing": "./testing.js",
  });
  assert.notEqual(core.private, true);
  assert.notEqual(sdk.private, true);
  assert.deepEqual(core.files, ["index.js", "internal"]);
  assert.deepEqual(sdk.files, ["README.md", "index.js", "internal", "testing.js"]);
  assert.equal(sdk.dependencies, undefined);
});

test("public entrypoint exposes the supported CLI", () => {
  const candidate = spawnSync(process.execPath, ["bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });

  assert.equal(candidate.status, 0, candidate.stderr);
  assert.match(candidate.stdout, /init \[options\] \[path\]/);
});

test("public entrypoint preserves the Node guard and CLI exit codes", () => {
  const entrypoint = path.resolve("bin/openspec-orch.js");
  const unsupported = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `Object.defineProperty(process.versions, "node", { value: "20.18.0" });\n` +
      `await import(${JSON.stringify(pathToFileURL(entrypoint).href)});`,
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /требует Node\.js 20\.19\.0 или новее/);

  const invalid = spawnSync(process.execPath, [entrypoint, "assign"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(invalid.status, 2);
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
