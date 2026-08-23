/** @fileoverview Изолированный candidate CLI E2E локальной Plugin installation. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  configuration,
  createCandidateProgram,
  createProject,
  PluginApplicationService,
  PluginInstallerService,
} from "@openspec-orch/core";

import {
  createPluginMaterializer,
  SAMPLE_PLUGIN_ROOT,
} from "./helpers/plugin-materializer.js";

/** Создаёт минимальный Store, который принимает candidate Core v3. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-init-e2e-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), configuration.serializeProject(
    createProject({
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
    }),
  ));
  return root;
}

test("candidate plugin init installs, declares and reuses a local Plugin end to end", async (t) => {
  const storeRoot = await storeFixture(t);
  const output = [];
  const applicationService = new PluginApplicationService({
    installerService: new PluginInstallerService({
      npmInstaller: createPluginMaterializer(),
    }),
  });
  const createProgram = () => createCandidateProgram({
    pluginCliOptions: {
      applicationService,
      output: { log: (value) => output.push(value) },
    },
  });
  const previousCwd = process.cwd();
  process.chdir(storeRoot);
  try {
    const args = [
      "node",
      "openspec-orch",
      "plugin",
      "init",
      "--plugin",
      "sample",
      "--from",
      SAMPLE_PLUGIN_ROOT,
    ];
    await (await createProgram()).parseAsync(args);
    const restarted = await createProgram();
    assert.equal(restarted.commands.some((command) => command.name() === "sample"), true);
    await restarted.parseAsync(args);
  } finally {
    process.chdir(previousCwd);
  }

  const project = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(project.plugins, ["sample"]);
  assert.equal(project.pluginDeclaration("sample").source, "local");
  const override = JSON.parse(await fs.readFile(
    path.join(storeRoot, ".openspec-orch/cache/local-plugins.json"),
    "utf8",
  ));
  assert.equal(override.plugins.sample, SAMPLE_PLUGIN_ROOT);
  const runtimeRoot = path.join(
    storeRoot,
    ".openspec-orch/cache/plugin-runtimes/sample/1.0.0",
  );
  const receipt = await fs.readFile(path.join(runtimeRoot, "installation.json"), "utf8");
  assert.equal(receipt.includes(SAMPLE_PLUGIN_ROOT), false);
  assert.deepEqual(output, [
    "sample: initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
    "sample: already_initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
  ]);
});
