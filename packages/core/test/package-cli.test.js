/** @fileoverview Публичная CLI-грамматика npm package supply. */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { ExtensionCommands, PackageCommands } from "@openspec-orch/core";

test("ExtensionCommands and PackageCommands expose separate public groups", async () => {
  const calls = [];
  const output = [];
  let rollbackRemove;
  const storeProject = Object.freeze({
    checkout: Object.freeze({}),
    project: Object.freeze({
      extensionDeclaration: () => Object.freeze({ id: "workflow" }),
      requireExtension: () => Object.freeze({ id: "workflow" }),
    }),
  });
  const status = Object.freeze({
    extensionId: "workflow",
    targetId: "specs",
    state: "ready",
    output: "enabled",
  });
  const packageReport = Object.freeze({
    state: "ready",
    runtimeRoot: "/workspace/specs/.openspec-orch/packages",
    packages: Object.freeze([]),
    mutable: 0,
    available: 0,
  });
  const extensionCommands = new ExtensionCommands({
    extensionApplication: {
      async install(project, id, source) {
        calls.push(["install", project, id, source]);
        return { initialized: true };
      },
      async remove(project, id, options) {
        rollbackRemove = options.rollbackRemove;
        await options.beforeRemove();
        calls.push(["remove", project, id]);
        return { removed: true };
      },
    },
    extensionLifecycle: {
      async connect(id) { calls.push(["connect", id]); },
      async disconnect(id) { calls.push(["disconnect", id]); },
      async remove(id) { calls.push(["native-remove", id]); },
      async statuses(options) { calls.push(["status", options.extensionId]); return [status]; },
    },
    output: { log: (value) => output.push(value) },
    storeProjectService: { async resolve() { return storeProject; } },
  });
  const packageCommands = new PackageCommands({
    output: { log: (value) => output.push(value) },
    storeProjectService: { async resolve() { return storeProject; } },
    supplyService: {
      forStore(checkout) {
        assert.equal(checkout, storeProject.checkout);
        return {
          async inspect() { calls.push(["package-status"]); return packageReport; },
          async sync() { calls.push(["sync"]); return true; },
        };
      },
    },
  });
  const program = new Command().exitOverride();
  extensionCommands.mount(program);
  packageCommands.mount(program);

  await program.parseAsync(["node", "test", "extension", "init", "workflow", "--from", "pkg@1.2.3"]);
  await program.parseAsync(["node", "test", "extension", "connect", "workflow"]);
  await program.parseAsync(["node", "test", "extension", "update", "workflow", "--from", "pkg@2.0.0"]);
  await program.parseAsync(["node", "test", "extension", "status", "workflow", "--json"]);
  await program.parseAsync(["node", "test", "extension", "disconnect", "workflow"]);
  await program.parseAsync(["node", "test", "extension", "remove", "workflow"]);
  await program.parseAsync(["node", "test", "package", "sync"]);
  await program.parseAsync(["node", "test", "package", "status", "--json"]);
  await rollbackRemove();

  assert.deepEqual(calls, [
    ["install", storeProject, "workflow", "pkg@1.2.3"],
    ["connect", "workflow"],
    ["status", "workflow"],
    ["install", storeProject, "workflow", "pkg@2.0.0"],
    ["status", "workflow"],
    ["disconnect", "workflow"],
    ["native-remove", "workflow"],
    ["remove", storeProject, "workflow"],
    ["sync"],
    ["package-status"],
    ["connect", "workflow"],
  ]);
  assert.deepEqual(output, [
    "✓ workflow — инициализирован",
    "✓ workflow — подключён",
    "✓ workflow → specs — готов",
    "  enabled",
    "✓ workflow — обновлён; выполните openspec-orch connect",
    `${JSON.stringify({ extensions: [status] }, null, 2)}`,
    "✓ workflow — отключён",
    "✓ workflow — удалён",
    "✓ Store packages восстановлены из package-lock.json",
    JSON.stringify(packageReport, null, 2),
  ]);
});
