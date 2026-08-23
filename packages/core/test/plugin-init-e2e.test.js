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
  PluginManagerService,
} from "@openspec-orch/core";

import {
  createPluginMaterializer,
  SAMPLE_PLUGIN_ROOT,
} from "./helpers/plugin-materializer.js";

/** Создаёт стандартный Workspace со Store и Code Repository для candidate Core v3. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-init-e2e-"));
  const workspaceRoot = path.join(await fs.realpath(temporary), "workspace");
  const storeRoot = path.join(workspaceRoot, "specs");
  const frontendRoot = path.join(workspaceRoot, "src", "frontend");
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(storeRoot, ".openspec-store"), { recursive: true });
  await fs.mkdir(path.join(storeRoot, "openspec"));
  await fs.mkdir(frontendRoot, { recursive: true });
  await fs.writeFile(
    path.join(storeRoot, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(storeRoot, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(storeRoot, "openspec-orch.yaml"), configuration.serializeProject(
    createProject({
      version: 3,
      strict: true,
      agents: ["codex"],
      plugins: [],
      repositories: [
        {
          id: "specs",
          role: "store",
          remote: "https://example.test/specs.git",
          defaultBranch: "main",
          plugins: [],
        },
        {
          id: "frontend",
          role: "code",
          remote: "https://example.test/frontend.git",
          defaultBranch: "main",
          plugins: [],
        },
      ],
    }),
  ));
  return storeRoot;
}

test("candidate Plugin survives restarts through its complete project lifecycle", async (t) => {
  const storeRoot = await storeFixture(t);
  const output = [];
  let installedSource;
  const applicationService = new PluginApplicationService({
    managerService: new PluginManagerService({
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
    const afterInit = await createProgram();
    assert.equal(afterInit.commands.some((command) => command.name() === "sample"), true);
    await afterInit.parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "connect",
      "sample",
      "--repo",
      "frontend",
    ]);
    await (await createProgram()).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "status",
      "--plugin",
      "sample",
      "--repo",
      "frontend",
      "--json",
    ]);
    await (await createProgram()).parseAsync(args);
    installedSource = configuration.parseProject(
      await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
    ).pluginDeclaration("sample").source;
    await (await createProgram()).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "disconnect",
      "sample",
      "--repo",
      "frontend",
    ]);
    await (await createProgram()).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "remove",
      "sample",
    ]);
    const afterRemove = await createProgram();
    assert.equal(afterRemove.commands.some((command) => command.name() === "sample"), false);
    await afterRemove.parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "remove",
      "sample",
    ]);
  } finally {
    process.chdir(previousCwd);
  }

  const project = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(project.plugins, []);
  assert.deepEqual(project.requireRepository("frontend").plugins, []);
  assert.equal(installedSource, "@test/openspec-orch-plugin-sample@1.0.0");
  assert.equal(project.pluginDeclaration("sample"), undefined);
  const runtimeRoot = path.join(
    storeRoot,
    ".openspec-orch/cache/plugin-runtimes/sample",
  );
  assert.equal(await fs.lstat(runtimeRoot).catch((error) => error.code), "ENOENT");
  assert.deepEqual(output, [
    "sample: initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
    "sample -> frontend: connected",
    JSON.stringify({
      plugins: [{
        pluginId: "sample",
        repositoryId: "frontend",
        state: "ready",
        output: "",
      }],
    }, null, 2),
    "sample: already_initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
    "sample -> frontend: disconnected",
    "sample: removed",
    "sample: not_initialized",
  ]);
});
