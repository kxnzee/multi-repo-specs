/** @fileoverview Проверки Core-only workspace state persistence. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CoreState,
  CoreStateService,
  createRepository,
  createRepositoryCheckout,
} from "@openspec-orch/core";

/** Создаёт Store checkout для state tests. */
async function stateFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-state-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createRepository({
    id: "specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
    plugins: [],
  });
  return {
    root,
    store: new CoreStateService().forStore(createRepositoryCheckout(repository, root)),
  };
}

test("CoreStateStore reads empty state and atomically remembers workspace", async (t) => {
  const { root, store } = await stateFixture(t);
  const workspace = path.join(root, "workspace");

  const empty = await store.read();
  assert.equal(empty instanceof CoreState, true);
  assert.equal(empty.workspace, null);
  const remembered = await store.update((current) => current.rememberWorkspace(workspace));

  assert.equal(remembered.workspace, workspace);
  assert.equal((await store.read()).workspace, workspace);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, ".openspec-orch/state.json"), "utf8")),
    { contract_version: 1, workspace },
  );
});

test("CoreStateStore rejects mixed legacy state without overwriting Plugin data", async (t) => {
  const { root, store } = await stateFixture(t);
  await fs.mkdir(path.join(root, ".openspec-orch"));
  const target = path.join(root, ".openspec-orch/state.json");
  const legacy = JSON.stringify({
    contract_version: 1,
    workspace: null,
    result_receipts: [{ receipt_id: "preserve" }],
  });
  await fs.writeFile(target, legacy, "utf8");

  await assert.rejects(store.read(), /сначала требуется миграция Plugin state/);
  await assert.rejects(store.write({ workspace: path.join(root, "workspace") }), /миграция/);
  assert.equal(await fs.readFile(target, "utf8"), legacy);
});

test("CoreStateStore rejects unsupported version and symlink state", async (t) => {
  const { root, store } = await stateFixture(t);
  await fs.mkdir(path.join(root, ".openspec-orch"));
  const target = path.join(root, ".openspec-orch/state.json");
  await fs.writeFile(target, JSON.stringify({ contract_version: 2, workspace: null }), "utf8");
  await assert.rejects(store.read(), /contract_version 1/);

  await fs.rm(target);
  const outside = path.join(root, "outside.json");
  await fs.writeFile(outside, JSON.stringify({ contract_version: 1, workspace: null }), "utf8");
  await fs.symlink(outside, target);
  await assert.rejects(store.read(), /обычным файлом/);
});
