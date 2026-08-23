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
  PluginInstallationRecord,
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

/** Создаёт portable installation record для fake Installer. */
function recordFixture(pluginId = "sample", packageName = "@test/plugin-sample") {
  return PluginInstallationRecord.parse({
    record_version: 1,
    plugin_id: pluginId,
    source: { kind: "local", spec: "local" },
    package: { name: packageName, version: "1.0.0", plugin: "./index.js" },
    dependencies: [{
      path: `node_modules/${packageName}`,
      name: packageName,
      version: "1.0.0",
      resolved: "local",
    }],
  });
}

/** Возвращает Installer service с наблюдаемым fake результатом. */
function installerFixture(record, calls) {
  return {
    forStore() {
      return {
        async install(pluginId, source) {
          calls.push({ pluginId, source });
          return { id: record.pluginId, record, source };
        },
        async remove(pluginId) {
          calls.push({ operation: "remove", pluginId });
          return true;
        },
      };
    },
  };
}

test("PluginApplicationService publishes config only after installation", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  const record = recordFixture();
  const calls = [];
  const service = new PluginApplicationService({
    installerService: installerFixture(record, calls),
  });

  const result = await service.install(storeProject, "sample", source);

  assert.equal(result instanceof PluginApplicationResult, true);
  assert.equal(result.initialized, true);
  assert.equal(result.installation.record, record);
  assert.equal(result.storeProject.project.version, 3);
  assert.equal(result.storeProject.project.pluginDeclaration("sample").source, "local");
  assert.equal(calls.length, 1);
  const projectSource = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");
  assert.match(projectSource, /version: 3/);
  assert.match(projectSource, /id: sample\n\s+source: local/);
  const overrides = JSON.parse(
    await fs.readFile(path.join(root, ".openspec-orch/cache/local-plugins.json"), "utf8"),
  );
  assert.equal(overrides.plugins.sample, path.join(root, "local-plugin"));
});

test("PluginApplicationService rejects an inconsistent installation before config publication", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const original = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");
  const calls = [];
  const service = new PluginApplicationService({
    installerService: installerFixture(recordFixture("another"), calls),
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
  await assert.rejects(
    fs.access(path.join(root, ".openspec-orch/cache/local-plugins.json")),
    /ENOENT/,
  );
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
    installerService: installerFixture(recordFixture(), []),
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
  const override = JSON.parse(
    await fs.readFile(path.join(root, ".openspec-orch/cache/local-plugins.json"), "utf8"),
  );
  assert.equal(override.plugins.sample, path.join(root, "local-plugin"));
});

test("PluginApplicationService removes an unbound Plugin and its local override", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new PluginApplicationService({
    installerService: installerFixture(recordFixture(), calls),
  });
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  await service.install(storeProject, "sample", source);

  const result = await service.remove(storeProject, "sample");
  const repeated = await service.remove(storeProject, "sample");

  assert.equal(result instanceof PluginRemovalResult, true);
  assert.equal(result.pluginId, "sample");
  assert.equal(result.removed, true);
  assert.equal(result.runtimeRemoved, true);
  assert.equal(repeated.removed, false);
  assert.equal(repeated.runtimeRemoved, false);
  assert.deepEqual(calls.map(({ operation }) => operation ?? "install"), ["install", "remove"]);
  const project = await storeProjects.load(root);
  assert.equal(project.project.hasPlugin("sample"), false);
  const overrides = JSON.parse(
    await fs.readFile(path.join(root, ".openspec-orch/cache/local-plugins.json"), "utf8"),
  );
  assert.deepEqual(overrides.plugins, {});
});

test("PluginApplicationService rejects removal while a Repository remains connected", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new PluginApplicationService({
    installerService: installerFixture(recordFixture(), calls),
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

test("PluginApplicationService validates local state before removing runtime", async (t) => {
  const { root, storeProject } = await storeFixture(t);
  const calls = [];
  const service = new PluginApplicationService({
    installerService: installerFixture(recordFixture(), calls),
  });
  const source = PluginSource.parse(path.join(root, "local-plugin"), { cwd: root });
  await service.install(storeProject, "sample", source);
  await fs.writeFile(
    path.join(root, ".openspec-orch/cache/local-plugins.json"),
    "{broken",
    "utf8",
  );
  const before = await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8");

  await assert.rejects(service.remove(storeProject, "sample"), /LOCAL_PLUGIN_OVERRIDE_INVALID/);

  assert.equal(await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"), before);
  assert.deepEqual(calls.map(({ operation }) => operation ?? "install"), ["install"]);
});
