/** @fileoverview Интеграционные сценарии read-only подготовки Explore. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { parse, stringify } from "yaml";

import { parseOrchestratorConfig, serializeOrchestratorConfig } from "../config/index.js";
import {
  buildExploreInvocation,
  findSpecRoot,
  prepareExplore,
  validateTicket,
} from "../explore/index.js";
import { runCommand } from "../shared/command.js";
import { agentFixture } from "../test-fixtures/agents.js";

const QWEN = agentFixture("qwen");
const ORCHESTRATOR_TEMPLATE =
  'version: 1\nversions:\n  process: draft\n  openspec: "1.7.0"\nagent: null\nrepositories: []\n';

/**
 * Создаёт автоматически удаляемый корень explore-сценария.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь временного каталога.
 */
async function temporaryRoot(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-explore-")),
  );
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Настраивает локальную Git identity для тестовых коммитов.
 *
 * @param {string} repository Путь тестового Git-репозитория.
 * @returns {void}
 */
function configureGit(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "OpenSpec Orchestrator Tests"]);
}

/**
 * Создаёт checkout с initial commit и соответствующим bare remote.
 *
 * @param {string} root Корень тестового сценария.
 * @param {string} relativePath Относительный путь checkout.
 * @param {string} remoteName Имя bare remote.
 * @param {Record<string, string>} files Начальные файлы checkout.
 * @returns {Promise<{checkout: string, remote: string}>} Канонический checkout и remote.
 */
async function createCheckout(root, relativePath, remoteName, files) {
  const checkout = path.join(root, relativePath);
  const remote = path.join(root, `${remoteName}.git`);
  await fs.mkdir(path.dirname(checkout), { recursive: true });
  runCommand("git", ["init", "--initial-branch", "main", checkout]);
  configureGit(checkout);
  for (const [relativeFile, contents] of Object.entries(files)) {
    const target = path.join(checkout, relativeFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  runCommand("git", ["-C", checkout, "add", "."]);
  runCommand("git", ["-C", checkout, "commit", "-m", "initial"]);
  runCommand("git", ["clone", "--bare", checkout, remote]);
  runCommand("git", ["-C", checkout, "remote", "add", "origin", remote]);
  return { checkout: await fs.realpath(checkout), remote };
}

/**
 * Собирает Store и необязательный Code Repository для Explore-тестов.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @param {{withCode?: boolean, archived?: string[]}} [options] Варианты сценария.
 * @returns {Promise<{
 *   root: string,
 *   workspace: string,
 *   storeRoot: string,
 *   storeRemote: string,
 *   codeRoot: string | undefined
 * }>} Пути подготовленного сценария.
 */
async function createScenario(t, { withCode = false, archived = [] } = {}) {
  const root = await temporaryRoot(t);
  const workspace = path.join(root, "workspace");
  const storeRemote = path.join(root, "payments-specs.git");
  const codeRemote = path.join(root, "api.git");
  const repositories = [
    {
      id: "payments-specs",
      role: "store",
      url: storeRemote,
      defaultBranch: "main",
    },
  ];
  if (withCode) {
    repositories.push({ id: "api", role: "code", url: codeRemote, defaultBranch: "main" });
  }

  const storeFiles = {
    ".openspec-store/store.yaml":
      `version: 1\nid: payments-specs\nremote: ${JSON.stringify(storeRemote)}\n`,
    "openspec-orch.yaml": serializeOrchestratorConfig(ORCHESTRATOR_TEMPLATE, repositories, QWEN),
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/context/00-start-here.md": "# Start\n",
    "openspec/context/system-map.yaml": "repositories: []\n",
    "openspec/changes/archive/.gitkeep": "",
    ".qwen/commands/opsx-explore.md": "---\ndescription: explore\n---\n",
    ".sdd/instructions/explore.md": "# Explore contract\n",
  };
  for (const name of archived) {
    storeFiles[`openspec/changes/archive/${name}/.gitkeep`] = "";
  }
  const store = await createCheckout(
    root,
    path.join("workspace", "payments-specs"),
    "payments-specs",
    storeFiles,
  );

  let code;
  if (withCode) {
    code = await createCheckout(
      root,
      path.join("workspace", "src", "api"),
      "api",
      { "openspec/config.yaml": "store: payments-specs\n", "src/index.js": "export {};\n" },
    );
  }
  return { root, workspace, storeRoot: store.checkout, storeRemote, codeRoot: code?.checkout };
}

/**
 * Имитирует JSON-команды OpenSpec, используемые предпроверками Explore.
 *
 * @param {string} storeRoot Ожидаемый путь Store.
 * @param {{activeChanges?: string[], declaredSource?: string, declaredStoreId?: string}} [options]
 * Управляемые ответы API.
 * @returns {{calls: Array<{args: string[], cwd: string | undefined}>, runner: typeof runCommand}}
 * Тестовый runner и журнал вызовов.
 */
function fakeOpenSpec(
  storeRoot,
  {
    activeChanges = [],
    declaredSource = "declared",
    declaredStoreId = "payments-specs",
  } = {},
) {
  const calls = [];
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push({ args, cwd: options.cwd });
    const joined = args.join(" ");
    if (joined === "--version") return "1.7.0";
    if (joined === "store list --json") {
      return JSON.stringify({ stores: [{ id: "payments-specs", root: storeRoot }], status: [] });
    }
    if (args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [{
          id: "payments-specs",
          root: storeRoot,
          metadata: { present: true, valid: true },
          openspec_root: { present: true, healthy: true, status: [] },
          status: [],
        }],
        status: [],
      });
    }
    const explicit = args.includes("--store");
    const root = {
      path: storeRoot,
      source: explicit ? "store" : declaredSource,
      store_id: explicit ? "payments-specs" : declaredStoreId,
    };
    if (args[0] === "doctor") {
      return JSON.stringify({
        root: { ...root, healthy: true, status: [] },
        store: explicit ? { id: "payments-specs", status: [] } : null,
        references: [],
        status: [],
      });
    }
    if (args[0] === "context") {
      return JSON.stringify({ root: { ...root, role: "openspec_root" }, members: [], status: [] });
    }
    if (args[0] === "list" && args.includes("--specs")) {
      return JSON.stringify({ specs: [], root });
    }
    if (args[0] === "list" && args.includes("--changes")) {
      return JSON.stringify({ changes: activeChanges.map((name) => ({ name })), root });
    }
    throw new Error(`Unexpected OpenSpec call: ${joined}`);
  };
  return { calls, runner };
}

test("parseOrchestratorConfig reads agent, Store and Code Repository roles", () => {
  const config = parseOrchestratorConfig(
    serializeOrchestratorConfig(ORCHESTRATOR_TEMPLATE, [
      { id: "project-specs", role: "store", url: "https://example.test/specs.git", defaultBranch: "main" },
      { id: "api", role: "code", url: "ssh://git@example.test/api.git", defaultBranch: "develop" },
    ], QWEN),
  );
  assert.equal(config.openSpecVersion, "1.7.0");
  assert.equal(config.storeRepository.id, "project-specs");
  assert.deepEqual(config.codeRepositories.map(({ id }) => id), ["api"]);
});

test("parseOrchestratorConfig rejects credentials embedded in HTTP repository URLs", () => {
  assert.throws(
    () => parseOrchestratorConfig(serializeOrchestratorConfig(ORCHESTRATOR_TEMPLATE, [
      { id: "project-specs", role: "store", url: "https://token@example.test/specs.git", defaultBranch: "main" },
    ], QWEN)),
  );
});

test("validateTicket accepts uppercase alphanumeric ticket parts", () => {
  assert.equal(validateTicket("PAY-412"), "PAY-412");
  assert.equal(validateTicket("TEST-001"), "TEST-001");
  assert.equal(validateTicket("TEST1-TEST0"), "TEST1-TEST0");
  assert.throws(() => validateTicket("pay-412"));
  assert.throws(() => validateTicket("TEST1-"));
  assert.throws(() => validateTicket("TEST1-TEST-0"));
});

test("findSpecRoot resolves the nearest Store from a nested directory", async (t) => {
  const scenario = await createScenario(t);
  const nested = path.join(scenario.storeRoot, "openspec", "context");
  assert.equal(await findSpecRoot(nested), scenario.storeRoot);
});

test("prepareExplore reports a lazy error when Template did not declare Explore handoff", async (t) => {
  const scenario = await createScenario(t);
  const configPath = path.join(scenario.storeRoot, "openspec-orch.yaml");
  const config = parse(await fs.readFile(configPath, "utf8"));
  delete config.agent.handoffs.explore;
  await fs.writeFile(configPath, stringify(config), "utf8");
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      workspace: scenario.workspace,
      ticket: "PAY-412",
      selectRepositories: () => [],
      commandRunner: openSpec.runner,
    }),
    /не объявил agent\.handoffs\.explore/,
  );
});

test("prepareExplore reports the declared Explore handoff when its file is missing", async (t) => {
  const scenario = await createScenario(t);
  await fs.rm(path.join(scenario.storeRoot, ".sdd", "instructions", "explore.md"));
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      workspace: scenario.workspace,
      ticket: "PAY-413",
      selectRepositories: () => [],
      commandRunner: openSpec.runner,
    }),
    /Отсутствует обычный файл \.sdd\/instructions\/explore\.md/,
  );
});

test("prepareExplore uses the connected workspace for Store-only Explore", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const result = await prepareExplore({
    start: scenario.storeRoot,
    ticket: "PAY-412",
    selectRepositories: async () => [],
    commandRunner: openSpec.runner,
  });
  assert.equal(result.workspace, scenario.workspace);
  assert.equal(result.projectSpecsOnly, true);
  assert.equal(result.repositories.length, 0);
  assert.equal(
    result.exploreInstructionsPath,
    path.join(scenario.storeRoot, ".sdd", "instructions", "explore.md"),
  );
  assert.match(result.store.revision, /^[0-9a-f]{40}$/);
  await assert.rejects(fs.stat(path.join(scenario.storeRoot, ".openspec-orch", "checkouts")));
});

test("prepareExplore uses the workspace remembered by connect", async (t) => {
  const scenario = await createScenario(t);
  const customStoreRoot = path.join(scenario.root, "custom-store");
  await fs.rename(scenario.storeRoot, customStoreRoot);
  runCommand("git", [
    "-C",
    customStoreRoot,
    "config",
    "--local",
    "openspec-orch.workspace",
    scenario.workspace,
  ]);
  const openSpec = fakeOpenSpec(customStoreRoot);

  const result = await prepareExplore({
    start: customStoreRoot,
    ticket: "PAY-426",
    selectRepositories: async () => [],
    commandRunner: openSpec.runner,
  });

  assert.equal(result.workspace, scenario.workspace);
});

test("prepareExplore resolves Store through a Code Repository pointer", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const result = await prepareExplore({
    start: path.join(scenario.codeRoot, "src"),
    ticket: "PAY-413",
    selectRepositories: async () => ["api"],
    commandRunner: openSpec.runner,
  });
  assert.equal(result.projectRoot, scenario.storeRoot);
  assert.equal(result.repositories[0].path, scenario.codeRoot);
  assert.ok(openSpec.calls.some(({ args, cwd }) => args.join(" ") === "context --json" && cwd === scenario.codeRoot));
});

test("buildExploreInvocation includes supplied runtime values", () => {
  const invocation = buildExploreInvocation({
    ticket: "PAY-415",
    intent: 'Понять, как показывать "статус платежа" в интерфейсе',
    projectRoot: "/work/openspec/payments-specs",
    storeRepositoryId: "payments-specs",
    workspace: "/work",
    store: { branch: "main", revision: "a".repeat(40) },
    projectSpecsOnly: false,
    repositories: [{ id: "api", branch: "main", revision: "b".repeat(40), path: "/work/src/api" }],
    exploreInstructionsPath: "/work/openspec/payments-specs/.sdd/instructions/explore.md",
  });
  for (const value of [
    "PAY-415",
    "a".repeat(40),
    "b".repeat(40),
    "/work/openspec/payments-specs",
    "/work/src/api",
    "/work/openspec/payments-specs/.sdd/instructions/explore.md",
  ]) {
    assert.equal(invocation.includes(value), true);
  }
});

test("buildExploreInvocation requires the request intent", () => {
  const result = {
    ticket: "PAY-415",
    intent: "Исследовать отображение статуса платежа",
    projectRoot: "/work/openspec/payments-specs",
    storeRepositoryId: "payments-specs",
    workspace: "/work",
    store: { branch: "main", revision: "a".repeat(40) },
    projectSpecsOnly: true,
    repositories: [],
    exploreInstructionsPath: "/work/openspec/payments-specs/.sdd/instructions/explore.md",
  };
  assert.throws(
    () => buildExploreInvocation({ ...result, intent: " " }),
  );
});

test("prepareExplore uses existing selected checkout at its exact clean revision", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  runCommand("git", ["-C", scenario.codeRoot, "config", "remote.origin.fetch", "+refs/heads/other:refs/remotes/origin/other"]);
  runCommand("git", ["-C", scenario.codeRoot, "update-ref", "-d", "refs/remotes/origin/main"]);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const result = await prepareExplore({
    start: scenario.storeRoot,
    ticket: "PAY-416",
    selectRepositories: async () => ["api"],
    commandRunner: openSpec.runner,
  });
  assert.equal(result.repositories[0].path, scenario.codeRoot);
  assert.equal(result.repositories[0].revision, runCommand("git", ["-C", scenario.codeRoot, "rev-parse", "HEAD"]));
  assert.equal(
    runCommand("git", ["-C", scenario.codeRoot, "rev-parse", "origin/main"]),
    result.repositories[0].revision,
  );
});

test("prepareExplore blocks a selected repository with a missing remote branch", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (
      command === "git" &&
      options?.cwd === scenario.codeRoot &&
      args.join(" ") === "ls-remote --heads origin refs/heads/main"
    ) return "";
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      ticket: "PAY-425",
      selectRepositories: async () => ["api"],
      commandRunner: runner,
    }),
  );
});

test("prepareExplore rejects an invalid Git revision", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (command === "git" && args.join(" ") === "rev-parse HEAD") return "not-a-sha";
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      ticket: "PAY-422",
      selectRepositories: async () => [],
      commandRunner: runner,
    }),
  );
});

test("prepareExplore blocks an active standard Change without state.yaml", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot, { activeChanges: ["pay-417-existing"] });
  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      ticket: "PAY-417",
      selectRepositories: async () => [],
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareExplore requires confirmation for an archived ticket", async (t) => {
  const scenario = await createScenario(t, { archived: ["2026-08-01-pay-418-done"] });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      ticket: "PAY-418",
      selectRepositories: async () => [],
      confirmArchivedChange: async () => false,
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareExplore preserves and blocks a dirty selected checkout", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  await fs.writeFile(path.join(scenario.codeRoot, "local.txt"), "do not touch\n", "utf8");
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareExplore({
      start: scenario.storeRoot,
      ticket: "PAY-419",
      selectRepositories: async () => ["api"],
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(await fs.readFile(path.join(scenario.codeRoot, "local.txt"), "utf8"), "do not touch\n");
});

test("prepareExplore blocks a Code Repository that resolves another source", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot, { declaredSource: "nearest" });
  await assert.rejects(
    prepareExplore({
      start: scenario.codeRoot,
      ticket: "PAY-420",
      selectRepositories: async () => ["api"],
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareExplore requires context.root.path from a Code Repository", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (
      command === "openspec" &&
      args.join(" ") === "context --json" &&
      options.cwd === scenario.codeRoot
    ) {
      return JSON.stringify({ status: [] });
    }
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    prepareExplore({
      start: scenario.codeRoot,
      ticket: "PAY-423",
      selectRepositories: async () => ["api"],
      commandRunner: runner,
    }),
  );
});

test("prepareExplore blocks a Code Repository that resolves another Store ID", async (t) => {
  const scenario = await createScenario(t, { withCode: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot, { declaredStoreId: "other-store" });

  await assert.rejects(
    prepareExplore({
      start: scenario.codeRoot,
      ticket: "PAY-424",
      selectRepositories: async () => ["api"],
      commandRunner: openSpec.runner,
    }),
  );
});

test("CLI rejects non-interactive explore before touching a project", () => {
  assert.throws(
    () => runCommand(process.execPath, [path.resolve("bin/openspec-orch.js"), "explore", "--ticket", "PAY-421"], {
      cwd: path.resolve("."),
    }),
  );
});
