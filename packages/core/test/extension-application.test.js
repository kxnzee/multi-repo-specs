/** @fileoverview Проверки атомарного удаления standalone Extension. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ExtensionApplicationService, storeProjects } from "@openspec-orch/core";

/** Создаёт Store с одной объявленной Extension. */
async function storeFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-ext-app-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), `version: 1
strict: true
template: { id: default }
agent: { id: qwen }
extensions: [workflow]
plugins: []
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: []
`);
  return { root, storeProject: await storeProjects.load(root) };
}

test("ExtensionApplication removes native state before publishing Store changes", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new ExtensionApplicationService({
    managerService: {
      forStore() {
        return {
          async prepareRemoval(extensionId) {
            calls.push(["prepare", extensionId]);
          },
          async remove(extensionId, publish) {
            calls.push(["package", extensionId]);
            await publish();
            return true;
          },
        };
      },
    },
  });

  await assert.rejects(service.remove(storeProject, "workflow", {
    beforeRemove: async () => { throw new Error("native remove failed"); },
  }), /native remove failed/);
  assert.deepEqual((await storeProjects.load(root)).project.extensions, ["workflow"]);

  const removed = await service.remove(storeProject, "workflow", {
    beforeRemove: async () => calls.push(["native", "workflow"]),
  });
  const repeated = await service.remove(storeProject, "workflow", {
    beforeRemove: async () => calls.push(["unexpected"]),
  });

  assert.equal(removed.removed, true);
  assert.equal(repeated.removed, false);
  assert.deepEqual(calls, [
    ["prepare", "workflow"],
    ["prepare", "workflow"],
    ["native", "workflow"],
    ["package", "workflow"],
  ]);
  assert.deepEqual((await storeProjects.load(root)).project.extensions, []);
});
