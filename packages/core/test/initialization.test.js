/** @fileoverview Characterization перенесённой Core init operation. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import {
  AgentCatalog,
  AgentCatalogEntry,
  AgentDefinition,
  CandidateCli,
  CoreConfiguration,
  ExtensionCatalog,
  ExtensionCatalogEntry,
  GitService,
  InitSelectionService,
  InitializationService,
  OpenSpecService,
  ProcessService,
  ProjectTemplateService,
  TemplateCatalog,
  TemplateCatalogEntry,
} from "@openspec-orch/core";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../../templates/default/", import.meta.url));

const TEST_AGENTS = new Map([
  ["claude", new AgentDefinition({
    id: "claude",
    name: "Claude Code",
    openspec: {
      adapter: "claude",
      generatedDirectory: ".claude",
      targetDirectory: ".claude",
      commandsDirectory: ".claude/commands/opsx",
      instructionsFile: "CLAUDE.md",
    },
    native: {
      adapter: "adapter.js",
      executable: "claude",
      scope: "local",
      manifest: ".claude-plugin/plugin.json",
    },
  })],
  ["qwen", new AgentDefinition({
    id: "qwen",
    name: "Qwen Code",
    openspec: {
      adapter: "qwen",
      generatedDirectory: ".qwen",
      targetDirectory: ".qwen",
      commandsDirectory: ".qwen/commands",
      instructionsFile: "QWEN.md",
    },
    native: {
      adapter: "adapter.js",
      executable: "qwen",
      scope: "project",
      manifest: "qwen-extension.json",
    },
  })],
]);

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
      await fs.mkdir(path.join(projectRoot, ".claude/skills/openspec-explore"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(projectRoot, ".claude/skills/openspec-explore/SKILL.md"),
        "upstream openspec skill\n",
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
      agentAdapter: Object.freeze({
        async adaptOpenSpecPack({ agent, targetRoot }) {
          if (agent.generatedDirectory === agent.targetDirectory) return;
          await fs.rename(
            path.join(targetRoot, agent.generatedDirectory),
            path.join(targetRoot, agent.targetDirectory),
          );
        },
      }),
      agentProvider: Object.freeze({
        resolve(agentId) {
          const agent = TEST_AGENTS.get(agentId);
          if (!agent) throw new Error(`AGENT_NOT_DISCOVERED: ${agentId}`);
          return agent;
        },
      }),
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
  assert.deepEqual(project.template, { id: "default" });
  assert.deepEqual(project.agent, { id: "claude" });
  assert.deepEqual(project.codeRepositories.map(({ id }) => id), ["frontend"]);
  assert.equal(await fs.lstat(path.join(root, "CLAUDE.md")).catch((error) => error.code), "ENOENT");
  assert.equal((await fs.stat(path.join(root, ".claude/commands/opsx"))).isDirectory(), true);
  assert.equal(
    await fs.readFile(path.join(root, ".claude/commands/opsx/opsx-explore.md"), "utf8"),
    "generated\n",
  );
  assert.equal(
    await fs.readFile(path.join(root, ".claude/skills/openspec-explore/SKILL.md"), "utf8"),
    "upstream openspec skill\n",
  );
  assert.equal((await fs.stat(path.join(root, "openspec/context/00-start-here.md"))).isFile(), true);
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

test("InitializationService preserves relaxed mode for an existing v2 Store", async (t) => {
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
  assert.deepEqual(result.updated, []);
  assert.deepEqual(project.agent, { id: "claude" });
});

test("custom Template is applied once and its source is not needed for repeated init", async (t) => {
  const root = await storeFixture(t);
  const customRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-custom-template-"));
  t.after(() => fs.rm(customRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(customRoot, "context"));
  await fs.writeFile(path.join(customRoot, "context/product.md"), "# Product\n");
  await fs.writeFile(path.join(customRoot, "template.yaml"), [
    "id: custom-product",
    "name: Custom Product",
    "copy:",
    "  - from: context",
    "    to: openspec/context",
    "",
  ].join("\n"));
  const fake = fakeExecutor(root);
  const { service, configurationService } = initFixture(fake.executor);

  await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    templateRoot: customRoot,
    extensions: [{ id: "superpowers", source: "bundled:superpowers" }],
    repositories: [configurationService.parseRepositoryArgument(
      "frontend=https://example.test/frontend.git#main",
    )],
  });
  const project = configurationService.parseProject(
    await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(project.template, { id: "custom-product" });
  assert.deepEqual(project.extensionDeclarations.map((extension) => extension.toConfig()), [
    { id: "superpowers", source: "bundled:superpowers" },
  ]);
  assert.equal((await fs.readFile(path.join(root, "openspec/context/product.md"), "utf8")), "# Product\n");

  await fs.rm(customRoot, { recursive: true, force: true });
  const repeated = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
  });
  assert.equal(repeated.alreadyInitialized, true);
  assert.deepEqual(
    configurationService.parseProject(
      await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"),
    ).extensions,
    ["superpowers"],
  );

  const augmented = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    extensions: [{ id: "openspec-base", source: "bundled:openspec-base" }],
    replaceExtensions: false,
  });
  assert.deepEqual(augmented.updated, ["openspec-orch.yaml"]);
  assert.deepEqual(
    configurationService.parseProject(
      await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"),
    ).extensions,
    ["openspec-base", "superpowers"],
  );

  const callCount = fake.calls.length;
  const changed = await service.initialize({
    target: root,
    storeId: "payments-specs",
    agentId: "claude",
    extensions: [],
  });
  assert.deepEqual(changed.updated, ["openspec-orch.yaml"]);
  assert.equal(fake.calls.length, callCount);
  assert.deepEqual(
    configurationService.parseProject(
      await fs.readFile(path.join(root, "openspec-orch.yaml"), "utf8"),
    ).extensions,
    [],
  );
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
  const availableExtensions = new ExtensionCatalog([
    new ExtensionCatalogEntry({
      id: "company-tools",
      name: "Company Tools",
      source: "bundled:company-tools",
    }),
    new ExtensionCatalogEntry({
      id: "superpowers",
      name: "Superpowers",
      source: "bundled:superpowers",
    }),
  ]);
  const cli = new CandidateCli({
    initSelectionService: new InitSelectionService({ extensionCatalog: availableExtensions }),
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
  const program = cli.createProgram();
  const initCommand = program.commands.find((command) => command.name() === "init");
  assert.equal(
    initCommand.options.find((option) => option.long === "--agent").description,
    "независимый Agent ID",
  );
  assert.equal(
    initCommand.options.find((option) => option.long === "--template").flags,
    "--template <id-or-path>",
  );
  assert.equal(
    initCommand.options.find((option) => option.long === "--template").description,
    "bundled Template ID с Extension-профилем или локальный Project Template",
  );
  await program.parseAsync([
    "node",
    "openspec-orch",
    "init",
    "project",
    "--store",
    "payments-specs",
    "--agent",
    "claude",
    "--extension",
    "superpowers",
    "--extension",
    "company-tools",
    "--repo",
    "frontend=https://example.test/frontend.git#main",
    "--no-strict",
  ]);

  assert.equal(calls[0].target, "project");
  assert.equal(calls[0].storeId, "payments-specs");
  assert.equal(calls[0].agentId, "claude");
  assert.equal(calls[0].templateId, "default");
  assert.equal(calls[0].templateRoot, TEMPLATE_ROOT);
  assert.deepEqual(calls[0].extensions, [
    { id: "superpowers", source: "bundled:superpowers" },
    { id: "company-tools", source: "bundled:company-tools" },
  ]);
  assert.equal(calls[0].replaceExtensions, true);
  assert.equal(calls[0].repositories[0].id, "frontend");
  assert.equal(calls[0].noStrict, true);
});

test("CandidateCli resolves an explicit bundled Template ID before initialization", async () => {
  const calls = [];
  const cli = new CandidateCli({
    bundledTemplateProvider: {
      defaultId: "default",
      catalog: {
        entries: [{ id: "default", name: "Default Project Template" }],
      },
      resolve(templateId) {
        if (templateId !== "default") throw new Error(`TEMPLATE_NOT_DISCOVERED: ${templateId}`);
        return { id: templateId, root: TEMPLATE_ROOT };
      },
    },
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
    "--template",
    "default",
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateId, "default");
  assert.equal(calls[0].templateRoot, TEMPLATE_ROOT);
});

test("CandidateCli rejects an unknown Template ID but preserves an explicit local path", async () => {
  const calls = [];
  const cli = new CandidateCli({
    bundledTemplateProvider: {
      defaultId: "default",
      catalog: { entries: [{ id: "default", name: "Default Project Template" }] },
      resolve(templateId) {
        if (templateId !== "default") {
          throw new Error(`TEMPLATE_NOT_DISCOVERED: ${templateId}`);
        }
        return { id: "default", root: TEMPLATE_ROOT };
      },
    },
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
  const args = [
    "node",
    "openspec-orch",
    "init",
    "project",
    "--store",
    "payments-specs",
    "--agent",
    "claude",
    "--template",
  ];

  await assert.rejects(
    cli.createProgram().parseAsync([...args, "unknown"]),
    /TEMPLATE_NOT_DISCOVERED: unknown/u,
  );
  assert.equal(calls.length, 0);

  await cli.createProgram().parseAsync([...args, "./team-template"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateId, undefined);
  assert.equal(calls[0].templateRoot, "./team-template");
});

test("CandidateCli interactive init builds the same normalized domain input", async () => {
  const calls = [];
  const confirmations = [];
  const agentCatalog = new AgentCatalog([
    new AgentCatalogEntry({ id: "qwen", name: "Qwen Code" }),
    new AgentCatalogEntry({ id: "claude", name: "Claude Code" }),
  ]);
  const extensionCatalog = new ExtensionCatalog([
    new ExtensionCatalogEntry({
      id: "openspec-base",
      name: "OpenSpec Base",
      source: "bundled:openspec-base",
    }),
    new ExtensionCatalogEntry({
      id: "superpowers",
      name: "Superpowers",
      source: "bundled:superpowers",
    }),
  ]);
  const templateCatalog = new TemplateCatalog([
    new TemplateCatalogEntry({
      id: "default",
      name: "Default Project Template",
      requiredExtensions: ["openspec-base", "superpowers"],
    }),
  ]);
  const cli = new CandidateCli({
    initSelectionService: new InitSelectionService({
      agentCatalog,
      extensionCatalog,
      templateCatalog,
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      inputPrompt: async ({ message }) => {
        if (message === "Store ID") return "payments-specs";
        if (message.startsWith("Code Repositories")) {
          return "frontend=https://example.test/frontend.git#main";
        }
        throw new Error(`unexpected input prompt: ${message}`);
      },
      selectPrompt: async ({ message, choices }) => {
        if (message === "Выберите Project Template") {
          assert.deepEqual(choices.map(({ name, value }) => ({ name, value })), [
            {
              name: "Default Project Template (default) — требует: openspec-base, superpowers",
              value: "default",
            },
            { name: "Локальный Project Template", value: "__local__" },
          ]);
          return "default";
        }
        if (message === "Выберите Agent") {
          assert.deepEqual(choices.map(({ value }) => value), ["claude", "qwen"]);
          return "qwen";
        }
        throw new Error(`unexpected select prompt: ${message}`);
      },
      checkboxPrompt: async ({ choices, theme }) => {
        assert.deepEqual(choices.map(({ value, checked, disabled }) => ({
          value,
          checked: checked ?? false,
          disabled: disabled ?? false,
        })), [
          {
            value: "openspec-base",
            checked: true,
            disabled: "Требуется Project Template default",
          },
          {
            value: "superpowers",
            checked: true,
            disabled: "Требуется Project Template default",
          },
        ]);
        assert.deepEqual(theme.icon, { checked: "[✓]", unchecked: "[ ]" });
        assert.equal(
          theme.style.disabledChoice("Superpowers (superpowers) required"),
          "[✓] Superpowers (superpowers) required",
        );
        return ["superpowers"];
      },
      confirmPrompt: async (options) => {
        confirmations.push(options);
        return true;
      },
    }),
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

  await cli.createProgram().parseAsync(["node", "openspec-orch", "init", "project"]);

  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[0].message, "Использовать strict mode?");
  assert.match(confirmations[1].message, /Store: payments-specs.*Agent: qwen.*Продолжить/u);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0], repositories: undefined }, {
    target: "project",
    storeId: "payments-specs",
    agentId: "qwen",
    templateId: "default",
    templateRoot: TEMPLATE_ROOT,
    extensions: [
      { id: "openspec-base", source: "bundled:openspec-base" },
      { id: "superpowers", source: "bundled:superpowers" },
    ],
    replaceExtensions: true,
    repositories: undefined,
    noStrict: false,
  });
  assert.equal(calls[0].repositories.length, 1);
  assert.equal(calls[0].repositories[0].id, "frontend");
  assert.equal(calls[0].repositories[0].role, "code");
  assert.equal(calls[0].repositories[0].remote, "https://example.test/frontend.git");
  assert.equal(calls[0].repositories[0].defaultBranch, "main");
});

test("init selects Template before Extensions and locks its required Extensions", async () => {
  const events = [];
  const selection = await new InitSelectionService({
    agentCatalog: new AgentCatalog([
      new AgentCatalogEntry({ id: "qwen", name: "Qwen Code" }),
    ]),
    extensionCatalog: new ExtensionCatalog([
      new ExtensionCatalogEntry({
        id: "openspec-base",
        name: "OpenSpec Base",
        source: "bundled:openspec-base",
      }),
      new ExtensionCatalogEntry({
        id: "superpowers",
        name: "Superpowers",
        source: "bundled:superpowers",
      }),
    ]),
    templateCatalog: new TemplateCatalog([
      new TemplateCatalogEntry({
        id: "default",
        name: "Default Project Template",
        requiredExtensions: ["openspec-base", "superpowers"],
      }),
    ]),
    defaultTemplateId: "default",
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    inputPrompt: async ({ message }) => {
      events.push(message);
      if (message === "Store ID") return "payments-specs";
      if (message.startsWith("Code Repositories")) return "";
      throw new Error(`unexpected input prompt: ${message}`);
    },
    selectPrompt: async ({ message }) => {
      events.push(message);
      if (message === "Выберите Project Template") return "default";
      if (message === "Выберите Agent") return "qwen";
      throw new Error(`unexpected select prompt: ${message}`);
    },
    checkboxPrompt: async ({ message, choices }) => {
      events.push(message);
      assert.deepEqual(choices.map(({ value, checked, disabled }) => ({
        value,
        checked: checked ?? false,
        disabled: disabled ?? false,
      })), [
        {
          value: "openspec-base",
          checked: true,
          disabled: "Требуется Project Template default",
        },
        {
          value: "superpowers",
          checked: true,
          disabled: "Требуется Project Template default",
        },
      ]);
      return [];
    },
    confirmPrompt: async ({ message }) => {
      events.push(message.startsWith("Store:") ? "Итоговое подтверждение" : message);
      return true;
    },
  }).resolve();

  assert.deepEqual(events, [
    "Store ID",
    "Выберите Project Template",
    "Выберите Agent",
    "Выберите standalone Extensions",
    "Code Repositories: id=remote#branch через пробел (необязательно)",
    "Использовать strict mode?",
    "Итоговое подтверждение",
  ]);
  assert.deepEqual(selection.extensions, [
    { id: "openspec-base", source: "bundled:openspec-base" },
    { id: "superpowers", source: "bundled:superpowers" },
  ]);
});

test("init applies required Extension profiles in flag mode and rejects disabling them", async () => {
  const service = new InitSelectionService({
    agentCatalog: new AgentCatalog([
      new AgentCatalogEntry({ id: "qwen", name: "Qwen Code" }),
    ]),
    extensionCatalog: new ExtensionCatalog([
      new ExtensionCatalogEntry({
        id: "openspec-base",
        name: "OpenSpec Base",
        source: "bundled:openspec-base",
      }),
      new ExtensionCatalogEntry({
        id: "superpowers",
        name: "Superpowers",
        source: "bundled:superpowers",
      }),
    ]),
    templateCatalog: new TemplateCatalog([
      new TemplateCatalogEntry({
        id: "default",
        name: "Default Project Template",
        requiredExtensions: ["openspec-base", "superpowers"],
      }),
    ]),
    defaultTemplateId: "default",
  });

  assert.deepEqual((await service.resolve({
    store: "payments-specs",
    agent: "qwen",
  })).extensions, [
    { id: "openspec-base", source: "bundled:openspec-base" },
    { id: "superpowers", source: "bundled:superpowers" },
  ]);

  for (const [template, extension] of [
    ["default", "openspec-base"],
    ["default", "superpowers"],
  ]) {
    await assert.rejects(service.resolve({
      store: "payments-specs",
      agent: "qwen",
      template,
      extensions: false,
    }), new RegExp(`TEMPLATE_REQUIRES_EXTENSION.*${template}.*${extension}`, "u"));
  }
});

test("CandidateCli interactive init cancels before mutation and non-TTY requires flags", async () => {
  const calls = [];
  const candidate = (selectionOverrides) => new CandidateCli({
    initSelectionService: new InitSelectionService({
      agentCatalog: new AgentCatalog([
        new AgentCatalogEntry({ id: "qwen", name: "Qwen Code" }),
      ]),
      extensionCatalog: new ExtensionCatalog(),
      ...selectionOverrides,
    }),
    templateRoot: TEMPLATE_ROOT,
    initializationService: { async initialize(options) { calls.push(options); } },
  }).createProgram();

  await assert.rejects(
    candidate({ stdin: { isTTY: false }, stdout: { isTTY: false } }).parseAsync([
      "node", "openspec-orch", "init", "project",
    ]),
    /INIT_SELECTION_REQUIRED.*--store и --agent/u,
  );

  let confirmCalls = 0;
  await candidate({
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    inputPrompt: async ({ message }) => message === "Store ID" ? "specs" : "",
    selectPrompt: async ({ message }) => message.includes("Template") ? "default" : "qwen",
    checkboxPrompt: async () => [],
    confirmPrompt: async () => {
      confirmCalls += 1;
      return confirmCalls === 1;
    },
  }).parseAsync(["node", "openspec-orch", "init", "project"]);

  assert.equal(confirmCalls, 2);
  assert.deepEqual(calls, []);
});
