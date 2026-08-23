/** @fileoverview Distribution composition smoke for bundled Change Tracking commands. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { configuration, createProject } from "@openspec-orch/core";

const CLI_PATH = fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));

test("candidate distribution initializes Change Tracking and mounts its root commands", async (t) => {
  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-distribution-"));
  t.after(() => fs.rm(storeRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(storeRoot, ".openspec-store"));
  await fs.mkdir(path.join(storeRoot, "openspec"));
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [],
    repositories: [{
      id: "specs",
      role: "store",
      remote: "https://example.test/specs.git",
      defaultBranch: "main",
      plugins: [],
    }],
  });
  await fs.writeFile(
    path.join(storeRoot, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(
    path.join(storeRoot, "openspec-orch.yaml"),
    configuration.serializeProject(project),
  );
  await fs.writeFile(path.join(storeRoot, "openspec/config.yaml"), "schema: spec-driven\n");

  await execa(process.execPath, [
    CLI_PATH,
    "plugin",
    "init",
    "--plugin",
    "change-tracking",
  ], { cwd: storeRoot });
  const { stdout } = await execa(process.execPath, [CLI_PATH, "--help"], { cwd: storeRoot });

  for (const command of ["assign", "status", "record", "verify"]) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`));
  }
  assert.doesNotMatch(stdout, /change-tracking\s+Команды Plugin/);
});
