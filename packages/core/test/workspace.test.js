/** @fileoverview Проверки публичного read-only Workspace API нового Core. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRepository,
  RepositoryCheckout,
  workspace,
  Workspace,
  WorkspaceResolver,
} from "@openspec-orch/core";

import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Создаёт изолированный временный каталог для path tests. */
async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/** Создаёт минимальный Repository fixture нужной role. */
function repository(id, role = "code") {
  return createRepository({
    id,
    role,
    remote: `https://example.test/${id}.git`,
    defaultBranch: "main",
    plugins: [],
  });
}

test("workspace facade infers only the standard <workspace>/<store-id> layout", async (t) => {
  const root = await temporaryDirectory(t);
  const storeRoot = path.join(root, "specs");
  await fs.mkdir(storeRoot);

  assert.equal(workspace instanceof WorkspaceResolver, true);
  assert.equal(workspace.inferStandard(storeRoot, "specs"), root);
  assert.equal(workspace.inferStandard(storeRoot, "other"), null);
  assert.equal(workspace.inferStandard(path.join(root, "openspec", "specs"), "specs"), null);

  const resolved = await workspace.resolve({ storeRoot, storeId: "specs" });
  assert.equal(resolved instanceof Workspace, true);
  assert.equal(resolved.root, await fs.realpath(root));
});

test("workspace resolution preserves explicit, stored and unresolved precedence", async (t) => {
  const root = await temporaryDirectory(t);
  const explicit = path.join(root, "explicit");
  const stored = path.join(root, "stored");
  await Promise.all([fs.mkdir(explicit), fs.mkdir(stored)]);

  const selected = await workspace.resolve({
    storeRoot: path.join(root, "nonstandard-store"),
    storeId: "specs",
    requestedWorkspace: explicit,
    storedWorkspace: stored,
  });
  assert.equal(selected.root, await fs.realpath(explicit));
  await assert.rejects(
    workspace.resolve({ storeRoot: path.join(root, "nonstandard-store"), storeId: "specs" }),
    (error) => error.code === "WORKSPACE_UNRESOLVED",
  );
});

test("Workspace owns checkout layout and rejects Store as Code checkout", async (t) => {
  const root = await temporaryDirectory(t);
  const model = new Workspace(root);
  const frontend = repository("frontend");

  assert.equal(model.repositoriesRoot, path.join(root, "src"));
  assert.equal(model.checkoutPath(frontend), path.join(root, "src", "frontend"));
  assert.throws(() => model.checkoutPath(repository("specs", "store")), /WORKSPACE_ROLE_UNSUPPORTED/);

  await fs.mkdir(model.checkoutPath(frontend), { recursive: true });
  const checkout = await workspace.resolveCheckout(model, frontend);
  assert.equal(checkout instanceof RepositoryCheckout, true);
  assert.equal(checkout.repository, frontend);
  assert.equal(checkout.root, await fs.realpath(model.checkoutPath(frontend)));
  await assert.rejects(
    workspace.resolveCheckout(model, repository("backend")),
    /REPOSITORY_CHECKOUT_UNAVAILABLE/,
  );
});

test("workspace resolves a Code Repository only from <workspace>/src", async (t) => {
  const root = await temporaryDirectory(t);
  const checkout = path.join(root, "src", "frontend");
  const invalidCheckout = path.join(root, "repositories", "frontend");
  await Promise.all([
    fs.mkdir(checkout, { recursive: true }),
    fs.mkdir(invalidCheckout, { recursive: true }),
  ]);

  const resolved = await workspace.fromCodeRepository(checkout);
  assert.equal(resolved.root, await fs.realpath(root));
  await assert.rejects(workspace.fromCodeRepository(invalidCheckout), /<workspace>\/src/);
});

test("workspace rejects a symlink instead of accepting an aliased root", async (t) => {
  const root = await temporaryDirectory(t);
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  await fs.mkdir(real);
  await createDirectoryLink(real, link);

  await assert.rejects(
    workspace.resolve({
      storeRoot: path.join(root, "nonstandard-store"),
      storeId: "specs",
      requestedWorkspace: link,
    }),
    /обычным каталогом/,
  );
});
