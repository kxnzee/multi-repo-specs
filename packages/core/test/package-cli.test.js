/** @fileoverview Публичная CLI-грамматика npm package supply. */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { PackageCommands } from "@openspec-orch/core";

test("PackageCommands exposes the complete Extension lifecycle and lockfile sync", async () => {
  const calls = [];
  const output = [];
  const storeProject = Object.freeze({
    checkout: Object.freeze({}),
    project: Object.freeze({ extensionDeclaration: () => Object.freeze({ id: "workflow" }) }),
  });
  const status = Object.freeze({
    extensionId: "workflow",
    targetId: "specs",
    state: "ready",
    output: "enabled",
  });
  const commands = new PackageCommands({
    extensionApplication: {
      async install(project, id, source) {
        calls.push(["install", project, id, source]);
        return { initialized: true };
      },
      async remove(project, id, { beforeRemove }) {
        await beforeRemove();
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
    supplyService: {
      forStore(checkout) {
        assert.equal(checkout, storeProject.checkout);
        return { async sync() { calls.push(["sync"]); return true; } };
      },
    },
  });
  const program = new Command().exitOverride();
  commands.mount(program);

  await program.parseAsync(["node", "test", "extension", "init", "workflow", "--from", "pkg@1.2.3"]);
  await program.parseAsync(["node", "test", "extension", "connect", "workflow"]);
  await program.parseAsync(["node", "test", "extension", "status", "workflow", "--json"]);
  await program.parseAsync(["node", "test", "extension", "disconnect", "workflow"]);
  await program.parseAsync(["node", "test", "extension", "remove", "workflow"]);
  await program.parseAsync(["node", "test", "package", "sync"]);

  assert.deepEqual(calls, [
    ["install", storeProject, "workflow", "pkg@1.2.3"],
    ["connect", "workflow"],
    ["status", "workflow"],
    ["status", "workflow"],
    ["disconnect", "workflow"],
    ["native-remove", "workflow"],
    ["remove", storeProject, "workflow"],
    ["sync"],
  ]);
  assert.deepEqual(output, [
    "✓ workflow — инициализирован",
    "✓ workflow — подключён",
    "✓ workflow → specs — готов",
    "  enabled",
    `${JSON.stringify({ extensions: [status] }, null, 2)}`,
    "✓ workflow — отключён",
    "✓ workflow — удалён",
    "✓ Store packages восстановлены из package-lock.json",
  ]);
});
