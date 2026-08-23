/** @fileoverview Characterization перенесённой Core init operation. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import {
  CandidateCli,
  CoreConfiguration,
  GitService,
  InitializationService,
  OpenSpecService,
  ProcessService,
  ProjectTemplateService,
} from "@openspec-orch/core";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../../templates/base/", import.meta.url));

/** Создаёт временный чистый Git Store с origin. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-candidate-init-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await execa("git", ["init", "--initial-branch", "main", root]);
  await execa("git", ["-C", root, "remote", "add", "origin", "https://example.test/specs.git"]);
  return root;
}

/** Создаёт executor Git плюс полностью контролируемого OpenSpec fixture. */
function fakeExecutor(projectRoot, { registered = false, failSetup = false } = {}) {
  const calls = [];
  const executor = async (executable, args, options) => {
    if (executable === "git") return execa(executable, args, options);
    assert.equal(executable, "openspec");
    calls.push(args);
    let stdout;
    if (args.join(" ") === "--version") stdout = "1.7.0";
    else if (args.join(" ") === "store list --json") {
      stdout = JSON.stringify({
        stores: registered ? [{ id: "registered", root: projectRoot }] : [],
        status: [],
      });
    } else if (args[0] === "init") {
      const profile = JSON.parse(
        await fs.readFile(path.join(options.env.XDG_CONFIG_HOME, "openspec/config.json"), "utf8"),
      );
      assert.equal(profile.profile, "custom");
      assert.equal(profile.delivery, "both");
      assert.equal(profile.workflows.includes("archive"), true);
      await fs.mkdir(path.join(projectRoot, ".claude/commands/opsx"), { recursive: true });
      await fs.writeFile(
        path.join(projectRoot, ".claude/commands/opsx/opsx-explore.md"),
        "generated\n",
        "utf8",
      );
      await fs.mkdir(path.join(projectRoot, "openspec"), { recursive: true });
      await fs.writeFile(path.join(projectRoot, "openspec/config.yaml"), "generated: true\n", "utf8");
      stdout = "initialized";
    } else if (args[0] === "store" && args[1] === "setup") {
      if (failSetup) {
        return {
          failed: true,
          stderr: "setup failed",
          stdout: "",
          exitCode: 1,
        };
      }
      const storeId = args[2];
      const remote = args[args.indexOf("--remote") + 1];
      await fs.mkdir(path.join(projectRoot, ".openspec-store"), { recursive: true });
      await fs.mkdir(path.join(projectRoot, "openspec/specs"), { recursive: true });
      await fs.mkdir(path.join(projectRoot, "openspec/changes/archive"), { recursive: true });
      await fs.writeFile(
        path.join(projectRoot, ".openspec-store/store.yaml"),
        `version: 1\nid: ${storeId}\nremote: ${remote}\n`,
        "utf8",
      );
      stdout = JSON.stringify({ store: { id: storeId, root: projectRoot }, status: [] });
    } else throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
    return { failed: false, stderr: "", stdout };
  };
  return { calls, executor };
}

/** Собирает init service с одним fake process boundary для Git и OpenSpec. */
function initFixture(executor) {
  const processService = new ProcessService(executor);
  const configurationService = new CoreConfiguration();
  return {
    configurationService,
    service: new InitializationService({
      configurationService,
      gitService: new GitService(processService),
      openSpecService: new OpenSpecService(processService),
      templateService: new ProjectTemplateService(),
    }),
  };
}

test("InitializationService creates Store through domain and public facade contracts", async (t) => {
  const root = await storeFixture(t);
  const fake = fakeExecutor(root);
  const { service, configurationService } = initFixture(fake.executor);
  const codeRepository = configurationService.parseRepositoryArgument(
    "frontend=https://example.test/frontend.git#main",
  );

  const result = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
    repositories: [codeRepository],
  });

  assert.equal(result.alreadyInitialized, false);
  assert.equal(result.executionMode, "strict");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.agent.id, "claude");
  assert.equal(result.created[0], ".openspec-store/store.yaml");
  assert.equal(result.created.includes("openspec-orch.yaml"), true);
  const project = configurationService.parseProject(
    await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(project.agents, ["claude"]);
  assert.deepEqual(project.codeRepositories.map(({ id }) => id), ["frontend"]);
  assert.equal((await fs.stat(path.join(root, "CLAUDE.md"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, ".claude/commands/opsx"))).isDirectory(), true);
  const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.openspec-orch\/plugins\/$/m);
  assert.match(gitignore, /^\.claude\/settings\.local\.json$/m);
  assert.equal(fake.calls.some((args) => args[0] === "init"), true);
  assert.equal(fake.calls.some((args) => args[0] === "store" && args[1] === "setup"), true);

  const callCount = fake.calls.length;
  const repeated = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
  });
  assert.equal(repeated.alreadyInitialized, true);
  assert.deepEqual(repeated.created, []);
  assert.equal(fake.calls.length, callCount);
});

test("InitializationService preserves relaxed mode and upgrades empty Agent registry", async (t) => {
  const root = await storeFixture(t);
  const fake = fakeExecutor(root);
  const { service, configurationService } = initFixture(fake.executor);
  await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
    noStrict: true,
  });
  const configPath = path.join(root, "openspec-orch.yaml");
  const source = (await fs.readFile(configPath, "utf8")).replace("agents:\n  - claude", "agents: []");
  await fs.writeFile(configPath, source, "utf8");
  await execa("git", ["-C", root, "add", "."]);
  await execa("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test",
    "commit", "-m", "initialized store"]);

  const result = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
  });
  const project = configurationService.parseProject(await fs.readFile(configPath, "utf8"));
  assert.equal(result.executionMode, "relaxed");
  assert.deepEqual(result.updated, ["openspec-orch.yaml"]);
  assert.deepEqual(project.agents, ["claude"]);
});

test("InitializationService fails before OpenSpec for dirty or conflicting Store", async (t) => {
  const dirtyRoot = await storeFixture(t);
  await fs.writeFile(path.join(dirtyRoot, "user-change.txt"), "dirty\n", "utf8");
  const dirtyFake = fakeExecutor(dirtyRoot);
  const dirtyService = initFixture(dirtyFake.executor).service;
  await assert.rejects(dirtyService.initialize({
    target: dirtyRoot,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
  }), /чистое рабочее дерево/);
  assert.deepEqual(dirtyFake.calls, []);

  const registeredRoot = await storeFixture(t);
  const registeredFake = fakeExecutor(registeredRoot, { registered: true });
  const registeredService = initFixture(registeredFake.executor).service;
  await assert.rejects(registeredService.initialize({
    target: registeredRoot,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
  }), /store unregister registered/);
  assert.equal(await fs.lstat(path.join(registeredRoot, "openspec-orch.yaml"))
    .catch((error) => error.code), "ENOENT");
});

test("InitializationService rolls generated files back when setup fails before metadata", async (t) => {
  const root = await storeFixture(t);
  const fake = fakeExecutor(root, { failSetup: true });
  const service = initFixture(fake.executor).service;

  await assert.rejects(service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: TEMPLATE_ROOT,
  }), /setup failed/);

  assert.equal(await fs.lstat(path.join(root, ".claude")).catch((error) => error.code), "ENOENT");
  assert.equal(await fs.lstat(path.join(root, "openspec/config.yaml"))
    .catch((error) => error.code), "ENOENT");
  assert.equal(await fs.lstat(path.join(root, "openspec-orch.yaml"))
    .catch((error) => error.code), "ENOENT");
});

test("CandidateCli preserves init grammar and passes normalized domain input", async () => {
  const calls = [];
  const cli = new CandidateCli({
    templateRoot: TEMPLATE_ROOT,
    initializationService: {
      async initialize(options) {
        calls.push(options);
        return {
          target: "/workspace/payments-specs",
          storeId: "payments-specs",
          alreadyInitialized: true,
          executionMode: "strict",
          created: [],
          updated: [],
        };
      },
    },
  });
  await cli.createProgram().parseAsync([
    "node",
    "openspec-orch",
    "init",
    "project",
    "--store",
    "payments-specs",
    "--agent",
    "claude",
    "--repo",
    "frontend=https://example.test/frontend.git#main",
    "--no-strict",
  ]);

  assert.equal(calls[0].target, "project");
  assert.equal(calls[0].storeId, "payments-specs");
  assert.equal(calls[0].agentId, "claude");
  assert.equal(calls[0].templateRoot, TEMPLATE_ROOT);
  assert.equal(calls[0].repositories[0].id, "frontend");
  assert.equal(calls[0].noStrict, true);
});
