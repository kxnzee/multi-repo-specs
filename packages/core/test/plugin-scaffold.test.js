/** @fileoverview Проверки нативного scaffold пользовательского Plugin. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { execa } from "execa";
import { PluginLoader, PluginScaffoldService, ProjectTemplateService } from "@openspec-orch/core";

import { createDirectoryLink } from "../fixtures/filesystem.js";
import { PLUGIN_SDK_ROOT } from "./helpers/plugin-materializer.js";

/** Делает публичный SDK доступным созданному локальному package без npm registry. */
async function linkSdk(packageRoot) {
  const scope = path.join(packageRoot, "node_modules", "@openspec-orch");
  await fs.mkdir(scope, { recursive: true });
  await createDirectoryLink(PLUGIN_SDK_ROOT, path.join(scope, "plugin-sdk"));
}

test("PluginScaffoldService creates convention-first commands, repository and native profiles", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-scaffold-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const cases = [
    {
      profile: "commands",
      inputProfile: undefined,
      supports: undefined,
      template: false,
      expectedSupports: [],
    },
    {
      profile: "repository",
      inputProfile: "repository",
      supports: ["store", "code", "code"],
      template: false,
      expectedSupports: ["store", "code"],
    },
    {
      profile: "native",
      inputProfile: "native",
      supports: ["code"],
      template: true,
      expectedSupports: ["code"],
    },
  ];
  for (const candidate of cases) {
    await t.test(candidate.profile, async () => {
      const pluginId = `${candidate.profile}-plugin`;
      const targetRoot = path.join(temporary, pluginId);
      const result = await new PluginScaffoldService().register({
        pluginId,
        targetRoot,
        name: `${candidate.profile} Plugin`,
        profile: candidate.inputProfile,
        supports: candidate.supports,
        template: candidate.template,
      });
      const canonicalRoot = await fs.realpath(targetRoot);
      assert.equal(result.root, canonicalRoot);
      assert.equal(result.entrypoint, path.join(canonicalRoot, "index.js"));
      const expectedFiles = [
        "README.md",
        ...(candidate.profile === "native" ? ["bin"] : []),
        "index.js",
        "package.json",
        ...(candidate.template ? ["template"] : []),
        "test",
      ].sort();
      assert.deepEqual((await fs.readdir(targetRoot)).sort(), expectedFiles);
      const manifest = JSON.parse(await fs.readFile(path.join(targetRoot, "package.json"), "utf8"));
      assert.equal(manifest.exports, "./index.js");
      assert.deepEqual(manifest.openspecOrchestrator, { apiVersion: 1, plugin: "./index.js" });
      assert.equal(manifest.peerDependencies["@openspec-orch/plugin-sdk"], "^0.1.0");
      assert.deepEqual(manifest.files, [
        "index.js",
        "README.md",
        ...(candidate.profile === "native" ? ["bin"] : []),
        ...(candidate.template ? ["template"] : []),
      ]);
      const [entrypoint, readme] = await Promise.all([
        fs.readFile(path.join(targetRoot, "index.js"), "utf8"),
        fs.readFile(path.join(targetRoot, "README.md"), "utf8"),
      ]);
      assert.match(readme, new RegExp(`Профиль: .${candidate.profile}.`, "u"));
      if (candidate.profile === "commands") {
        assert.doesNotMatch(entrypoint, /repository:/u);
        assert.match(entrypoint, /registerCommands/u);
      } else {
        assert.match(entrypoint, /PLUGIN_STATUS_NOT_IMPLEMENTED/u);
        assert.equal(entrypoint.includes("registerCommands"), candidate.profile === "repository");
        assert.equal(entrypoint.includes("context.process.run"), candidate.profile === "native");
        assert.match(readme, /Реализуйте .*connect\/status.* перед установкой/u);
      }
      if (candidate.template) {
        assert.match(
          await fs.readFile(path.join(targetRoot, "template/template.yaml"), "utf8"),
          /^agents: \{\}\n$/u,
        );
        const templateTarget = path.join(temporary, `${pluginId}-template-target`);
        await fs.mkdir(templateTarget);
        const plan = await new ProjectTemplateService().planPlugin({
          agentId: "qwen",
          targetRoot: templateTarget,
          templateRoot: path.join(targetRoot, "template"),
        });
        assert.deepEqual(plan.targetPaths, []);
      }
      await linkSdk(targetRoot);
      const loaded = await new PluginLoader().load({
        packageRoot: await fs.realpath(targetRoot),
        pluginId,
      });
      assert.deepEqual(loaded.supports, candidate.expectedSupports);
      const contract = await execa(process.execPath, ["--test"], { cwd: targetRoot, reject: false });
      assert.equal(contract.exitCode, 0, contract.stderr || contract.stdout);
    });
  }
});

test("ProjectTemplateService rejects Base Agent metadata in a Plugin Template", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-template-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const templateRoot = path.join(temporary, "template");
  const targetRoot = path.join(temporary, "store");
  await fs.mkdir(templateRoot);
  await fs.mkdir(targetRoot);
  await fs.writeFile(path.join(templateRoot, "template.yaml"), `agents:
  qwen:
    openspec_adapter: qwen
    copy: []
`);

  await assert.rejects(
    new ProjectTemplateService().planPlugin({ agentId: "qwen", targetRoot, templateRoot }),
    /openspec_adapter/u,
  );
});

test("PluginScaffoldService rejects invalid, reserved and existing targets", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-scaffold-errors-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const scaffolds = new PluginScaffoldService();

  await assert.rejects(
    scaffolds.register({ pluginId: "Invalid", targetRoot: path.join(temporary, "invalid") }),
    /PLUGIN_ID_INVALID/,
  );
  await assert.rejects(
    scaffolds.register({ pluginId: "plugin", targetRoot: path.join(temporary, "reserved") }),
    /PLUGIN_ID_RESERVED/,
  );
  await assert.rejects(
    scaffolds.register({
      pluginId: "sample",
      profile: "unknown",
      targetRoot: path.join(temporary, "unknown-profile"),
    }),
    /PLUGIN_PROFILE_INVALID/,
  );
  await assert.rejects(
    scaffolds.register({
      pluginId: "sample",
      profile: "commands",
      supports: ["code"],
      targetRoot: path.join(temporary, "commands-support"),
    }),
    /PLUGIN_SUPPORT_INVALID/,
  );
  await fs.mkdir(path.join(temporary, "existing"));
  await assert.rejects(
    scaffolds.register({ pluginId: "sample", targetRoot: path.join(temporary, "existing") }),
    /PLUGIN_TARGET_EXISTS/,
  );
});
