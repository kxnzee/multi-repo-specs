/** @fileoverview Проверки координации Plugin installation и project config. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configuration,
  PluginApplicationResult,
  PluginApplicationService,
  PluginRemovalResult,
  PluginSource,
  storeProjects,
} from "@openspec-orch/core";

/** Создаёт минимальный существующий Store с project config version 3. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-app-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.mkdir(path.join(root, "local-plugin"));
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), `version: 3
strict: true
agents: [codex]
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

/** Возвращает Plugin Manager service с наблюдаемым fake результатом. */
function managerFixture(calls, { installedId = "sample", packageName = "@test/plugin-sample" } = {}) {
  return {
    forStore() {
      return {
        async install(pluginId, source, publish) {
          calls.push({ pluginId, source });
          const installation = {
            id: installedId,
            declaration: `${packageName}@1.0.0`,
            source,
          };
          await publish(installation);
          return installation;
        },
        async remove(pluginId, publish) {
          calls.push({ operation: "remove", pluginId });
          await publish();
          return true;
        },
      };
    },
  };
}

test("PluginApplicationService publishes config only after installation", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  const calls = [];
  const service = new PluginApplicationService({
    managerService: managerFixture(calls),
  });

  const result = await service.install(storeProject, "sample", source);

  assert.equal(result instanceof PluginApplicationResult, true);
  assert.equal(result.initialized, true);
  const current = await storeProjects.load(root);
  assert.equal(current.project.version, 3);
  assert.equal(
    current.project.pluginDeclaration("sample").source,
    "@test/plugin-sample@1.0.0",
  );
  assert.equal(calls.length, 1);
  const projectSource = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");
  assert.match(projectSource, /version: 3/);
  assert.match(projectSource, /id: sample\n\s+source: "@test\/plugin-sample@1.0.0"/);
});

test("PluginApplicationService rejects an inconsistent installation before config publication", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const original = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");
  const calls = [];
  const service = new PluginApplicationService({
    managerService: managerFixture(calls, { installedId: "another" }),
  });

  await assert.rejects(
    service.install(
      storeProject,
      "sample",
      PluginSource.parse(path.join(root, "local-plugin"), { cwd: root }),
    ),
    /несогласованный installation/,
  );

  assert.equal(calls.length, 1);
  assert.equal(await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"), original);
});

test("PluginApplicationService leaves config unchanged when publication fails", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const originalProject = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");
  const service = new PluginApplicationService({
    fileService: {
      forRepository() {
        return { async write() { throw new Error("config write failed"); } };
      },
    },
    managerService: managerFixture([]),
  });

  await assert.rejects(
    service.install(
      storeProject,
      "sample",
      PluginSource.parse(path.join(root, "local-plugin"), { cwd: root }),
    ),
    /config write failed/,
  );

  assert.equal(await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"), originalProject);
});

test("PluginApplicationService removes an unbound Plugin and its runtime", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new PluginApplicationService({
    managerService: managerFixture(calls),
  });
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  await service.install(storeProject, "sample", source);

  const result = await service.remove(storeProject, "sample");
  const repeated = await service.remove(storeProject, "sample");

  assert.equal(result instanceof PluginRemovalResult, true);
  assert.equal(result.removed, true);
  assert.equal(repeated.removed, false);
  assert.deepEqual(calls.map(({ operation }) => operation ?? "install"), ["install", "remove"]);
  const project = await storeProjects.load(root);
  assert.equal(project.project.hasPlugin("sample"), false);
});

test("PluginApplicationService keeps declaration when removal publication fails", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  await new PluginApplicationService({
    managerService: managerFixture([]),
  }).install(storeProject, "sample", source);
  const service = new PluginApplicationService({
    fileService: {
      forRepository() {
        return { async write() { throw new Error("config write failed"); } };
      },
    },
    managerService: managerFixture([]),
  });

  await assert.rejects(service.remove(storeProject, "sample"), /config write failed/);

  const project = await storeProjects.load(root);
  assert.equal(project.project.hasPlugin("sample"), true);
});

test("PluginApplicationService rejects removal while a Repository remains connected", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new PluginApplicationService({
    managerService: managerFixture(calls),
  });
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  await service.install(storeProject, "sample", source);
  const current = await storeProjects.load(root);
  current.project.connectPlugin("sample", ["specs"]);
  await fs.writeFile(
    path.join(root, "openspec-orch.yaml"),
    configuration.serializeProject(current.project),
  );
  const before = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");

  await assert.rejects(service.remove(storeProject, "sample"), /PLUGIN_CONNECTED/);

  assert.equal(await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"), before);
  assert.deepEqual(calls.map(({ operation }) => operation ?? "install"), ["install"]);
});
