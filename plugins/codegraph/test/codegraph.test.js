/** @fileoverview Самостоятельный контракт поставки CodeGraph Plugin Package. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("Package owns its CodeGraph dependency and descriptor", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  const descriptor = parse(await fs.readFile(path.join(packageRoot, "plugin.yaml"), "utf8"));

  assert.equal(packageManifest.name, "@openspec-orch/plugin-codegraph");
  assert.equal(packageManifest.dependencies["@colbymchenry/codegraph"], "1.5.0");
  assert.equal(packageManifest.openspecOrchestrator.entrypoint, "bin/codegraph.js");
  assert.equal(descriptor.id, "codegraph");
  assert.equal(descriptor.version, packageManifest.version);
});

test("Package launcher runs without a global CodeGraph executable", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, "bin", "codegraph.js"), "--version"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1.5.0");
});
