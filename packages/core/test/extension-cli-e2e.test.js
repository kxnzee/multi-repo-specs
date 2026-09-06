/** @fileoverview Сквозной CLI smoke внешней npm Extension без реального Agent. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Command } from "commander";

import {
  ExtensionApplicationService,
  ExtensionLifecycle,
  ExtensionManagerService,
  NpmPackageInstaller,
  PackageCommands,
  PackageSupplyService,
  storeProjects,
} from "@openspec-orch/core";

/** Проверяет public CLI поверх реальных manager/application/lifecycle слоёв. */
test("extension CLI installs, runs and removes one external npm package", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-ext-e2e-")));
  const source = path.join(root, "external-extension");
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.mkdir(source);
  await fs.writeFile(path.join(root, ".openspec-store/store.yaml"), [
    "version: 1", "id: specs", "remote: https://example.test/specs.git", "",
  ].join("\n"));
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), [
    "version: 1", "strict: true", "template: { id: default }", "agent: { id: qwen }",
    "extensions: []", "plugins: []", "repositories:", "  - id: specs", "    roles: [store]",
    "    remote: https://example.test/specs.git", "    default_branch: main", "    plugins: []", "",
  ].join("\n"));
  await fs.writeFile(path.join(source, "package.json"), JSON.stringify({
    name: "@test/workflow-extension",
    version: "1.0.0",
    openspecOrchestrator: { apiVersion: 1, extension: "./extension.yaml" },
  }));
  await fs.writeFile(path.join(source, "extension.yaml"), [
    "id: workflow", "name: Workflow", "manifests:", "  qwen: qwen-extension.json", "",
  ].join("\n"));
  await fs.writeFile(path.join(source, "qwen-extension.json"), "{\"name\":\"workflow\"}\n");

  const npmInstaller = new NpmPackageInstaller({
    environment: { NPM_CONFIG_CACHE: path.join(root, ".npm-cache") },
  });
  let removalFails = false;
  const supplyService = new PackageSupplyService({
    installer: {
      install: (options) => npmInstaller.install(options),
      remove: (options) => removalFails
        ? Promise.reject(new Error("simulated npm removal failure"))
        : npmInstaller.remove(options),
      sync: (options) => npmInstaller.sync(options),
    },
  });
  const managerService = new ExtensionManagerService({
    agentIds: ["qwen"],
    bundledProvider: { has() { return false; }, resolve() {} },
    supplyService,
  });
  const projectService = {
    load: (candidate) => storeProjects.load(candidate),
    resolve: () => storeProjects.load(root),
  };
  const nativeCalls = [];
  const lifecycle = new ExtensionLifecycle({
    agentAdapter: {
      async preflight() { nativeCalls.push("preflight"); },
      async validateExtension(extension) {
        assert.equal(extension.manifests.qwen, "qwen-extension.json");
        nativeCalls.push("validate");
      },
      async invokeExtension(_context, _extension, request) {
        nativeCalls.push(request.operation);
        return request.operation === "status" ? "enabled" : "";
      },
    },
    managerService,
    processService: { forRepository() { return { async run() {} }; } },
    start: root,
    storeProjectService: projectService,
  });
  const commands = new PackageCommands({
    extensionApplication: new ExtensionApplicationService({ managerService }),
    extensionLifecycle: lifecycle,
    output: { log() {} },
    supplyService,
    storeProjectService: projectService,
  });
  const program = new Command().exitOverride();
  commands.mount(program);

  await program.parseAsync(["node", "test", "extension", "init", "workflow", "--from", source]);
  assert.deepEqual((await storeProjects.load(root)).project.extensions, ["workflow"]);
  await program.parseAsync(["node", "test", "extension", "connect", "workflow"]);
  removalFails = true;
  await assert.rejects(
    program.parseAsync(["node", "test", "extension", "remove", "workflow"]),
    /simulated npm removal failure/,
  );
  assert.deepEqual((await storeProjects.load(root)).project.extensions, ["workflow"]);
  removalFails = false;
  await program.parseAsync(["node", "test", "extension", "remove", "workflow"]);

  const runtimeManifest = JSON.parse(await fs.readFile(
    path.join(root, ".openspec-orch/packages/package.json"),
    "utf8",
  ));
  assert.deepEqual((await storeProjects.load(root)).project.extensions, []);
  assert.deepEqual(runtimeManifest.dependencies, {});
  assert.deepEqual(runtimeManifest.openspecOrchestrator.extensions, {});
  assert.deepEqual(nativeCalls, [
    "preflight", "validate", "connect", "status", "remove",
    "preflight", "validate", "connect", "remove",
  ]);
});
