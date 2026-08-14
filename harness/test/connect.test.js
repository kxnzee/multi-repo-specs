/** @fileoverview Интеграционные сценарии подключения Store и Code Repositories. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { connectProject } from "../connect/index.js";
import { resolveAgentAdapter } from "../config/agents.js";
import { serializeOrchestratorConfig } from "../config/index.js";
import { runCommand } from "../shared/command.js";

const QWEN_AGENT = resolveAgentAdapter("qwen");
const GIGACODE_AGENT = resolveAgentAdapter("gigacode");

/**
 * Создаёт удаляемый после теста корень multi-repo workspace.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь временного каталога.
 */
async function temporaryWorkspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-connect-"));
  const canonicalRoot = await fs.realpath(root);
  t.after(async () => fs.rm(canonicalRoot, { recursive: true, force: true }));
  return canonicalRoot;
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
 * Создаёт тестовый source-репозиторий и соответствующий bare remote.
 *
 * @param {string} root Корень тестового сценария.
 * @param {string} name Базовое имя репозитория.
 * @param {Record<string, string>} [files] Начальные файлы source-репозитория.
 * @returns {Promise<string>} Путь созданного bare remote.
 */
async function createBareRemote(root, name, files = {}) {
  const source = path.join(root, `${name}-source`);
  const remote = path.join(root, `${name}.git`);
  runCommand("git", ["init", "--initial-branch", "main", source]);
  configureGit(source);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(source, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  runCommand("git", ["-C", source, "add", "."]);
  runCommand("git", ["-C", source, "commit", "--allow-empty", "-m", "initial"]);
  runCommand("git", ["clone", "--bare", source, remote]);
  return remote;
}

/**
 * Собирает центральный Store, Code remote и локальный workspace для connect-тестов.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @param {{pointer?: boolean, agent?: typeof QWEN_AGENT}} [options]
 * Нужно ли заранее принять project pointer и какой adapter записать в Store.
 * @returns {Promise<{
 *   root: string,
 *   workspace: string,
 *   storeRoot: string,
 *   centralRemote: string,
 *   codeRemote: string
 * }>} Пути подготовленного сценария.
 */
async function createScenario(t, { pointer = false, agent = QWEN_AGENT } = {}) {
  const root = await temporaryWorkspace(t);
  const codeFiles = pointer ? { "openspec/config.yaml": "store: payments-specs\n" } : {};
  const codeRemote = await createBareRemote(root, "api", codeFiles);
  const centralSource = path.join(root, "central-source");
  runCommand("git", ["init", "--initial-branch", "main", centralSource]);
  configureGit(centralSource);

  const centralRemote = path.join(root, "payments-specs.git");
  const orchestratorTemplate = 'version: 1\n\nversions:\n  process: draft\n  openspec: "1.7.0"\n\nagent: null\n\nrepositories: []\n';
  const centralFiles = {
    ".openspec-store/store.yaml": `version: 1\nid: payments-specs\nremote: ${JSON.stringify(centralRemote)}\n`,
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/specs/.gitkeep": "",
    "openspec/changes/.gitkeep": "",
    [path.join(agent.commandsDirectory, "opsx-continue.md")]: "---\ndescription: continue\n---\n",
    [path.join(agent.commandsDirectory, "opsx-explore.md")]: "---\ndescription: explore\n---\n",
    [path.join(agent.commandsDirectory, "opsx-update.md")]: "---\ndescription: update\n---\n",
    [path.join(agent.commandsDirectory, "sdd-change.md")]: "---\ndescription: change\n---\n",
    [path.join(agent.commandsDirectory, "sdd-context.md")]: "---\ndescription: context\n---\n",
    [path.join(agent.commandsDirectory, "sdd-apply.md")]: "---\ndescription: apply\n---\n",
    [agent.instructionsFile]: `# Instructions for ${agent.id}\n`,
    [path.join(".sdd", "instructions", "explore.md")]: "# Explore contract\n",
    "openspec-orch.yaml": serializeOrchestratorConfig(orchestratorTemplate, [
      {
        id: "payments-specs",
        role: "store",
        url: centralRemote,
        defaultBranch: "main",
      },
      { id: "api", role: "code", url: codeRemote, defaultBranch: "main" },
    ], agent),
  };
  for (const subagent of agent.requiredSubagents) {
    centralFiles[path.join(agent.agentsDirectory, subagent)] =
      `---\nname: ${path.basename(subagent, ".md")}\n---\n`;
  }
  for (const [relativePath, contents] of Object.entries(centralFiles)) {
    const target = path.join(centralSource, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  runCommand("git", ["-C", centralSource, "add", "."]);
  runCommand("git", ["-C", centralSource, "commit", "-m", "initialize store"]);
  runCommand("git", ["clone", "--bare", centralSource, centralRemote]);

  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(workspace, "payments-specs");
  await fs.mkdir(workspace, { recursive: true });
  runCommand("git", ["clone", centralRemote, storeRoot]);
  return { root, workspace, storeRoot, centralRemote, codeRemote };
}

/**
 * Создаёт управляемую имитацию OpenSpec Store API для connect-тестов.
 *
 * @param {string} storeRoot Ожидаемый путь Store.
 * @param {Array<{id: string, root: string}>} [initialStores] Начальное состояние registry.
 * @returns {{
 *   calls: Array<{args: string[], cwd: string | undefined}>,
 *   runner: typeof runCommand,
 *   stores: () => Array<{id: string, root: string}>
 * }} Тестовый runner и накопленное состояние вызовов.
 */
function fakeOpenSpec(storeRoot, initialStores = []) {
  let stores = [...initialStores];
  const calls = [];
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push({ args, cwd: options.cwd });

    if (args.join(" ") === "--version") return "1.7.0";
    if (args.join(" ") === "store list --json") {
      return JSON.stringify({ stores, status: [] });
    }
    if (args[0] === "store" && args[1] === "register") {
      if (stores.some(({ id, root }) => id === "payments-specs" && root !== storeRoot)) {
        throw new Error("OpenSpec: Store payments-specs уже зарегистрирован по другому пути");
      }
      stores = [{ id: "payments-specs", root: storeRoot }];
      return JSON.stringify({
        store: stores[0],
        registry: { registered: true, already_registered: false },
        git: { is_repository: true, initialized: false, committed: false },
        created_files: [],
        status: [],
      });
    }
    if (args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [
          {
            id: "payments-specs",
            root: storeRoot,
            metadata: { present: true, valid: true },
            openspec_root: { present: true, healthy: true, status: [] },
            status: [],
          },
        ],
        status: [],
      });
    }

    const explicit = args.includes("--store");
    const root = {
      path: storeRoot,
      source: explicit ? "store" : "declared",
      store_id: "payments-specs",
    };
    if (args[0] === "doctor") {
      if (!args.includes("--json")) return "human-doctor-output";
      return JSON.stringify({
        root: { ...root, healthy: true, status: [] },
        store: { id: "payments-specs", status: [] },
        references: [],
        status: [],
      });
    }
    if (args[0] === "context") {
      return JSON.stringify({ root: { ...root, role: "openspec_root" }, members: [], status: [] });
    }
    if (args[0] === "list") return JSON.stringify({ specs: [], root });
    throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
  };
  return { calls, runner, stores: () => stores };
}

test("connectProject registers Store, clones a missing repository and creates its pointer", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  const result = await connectProject({
    start: scenario.storeRoot,
    commandRunner: openSpec.runner,
  });

  assert.equal(result.status, "needs_setup_pr");
  assert.deepEqual(openSpec.stores(), [{ id: "payments-specs", root: scenario.storeRoot }]);
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].cloned, true);
  assert.equal(result.repositories[0].pointerCreated, true);
  assert.equal(
    await fs.readFile(path.join(scenario.workspace, "src/api/openspec/config.yaml"), "utf8"),
    "store: payments-specs\n",
  );
  assert.equal(
    runCommand("git", ["-C", path.join(scenario.workspace, "src/api"), "status", "--porcelain"])
      .includes("openspec/"),
    true,
  );
});

test("connectProject reports human-readable OpenSpec doctor output without blocking", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const progress = [];
  const runner = (command, args, options = {}) => {
    if (command === "openspec" && args[0] === "doctor") {
      options.onStderr?.("project config warning");
    }
    return openSpec.runner(command, args, options);
  };

  const result = await connectProject({
    start: scenario.storeRoot,
    commandRunner: runner,
    onProgress: (message) => progress.push(message),
  });

  assert.equal(result.status, "needs_setup_pr");
  assert.equal(progress.includes("human-doctor-output"), true);
  assert.equal(progress.some((message) => message.includes("project config warning")), true);
});

test("connectProject is idempotent for an accepted pointer and existing checkout", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  const first = await connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner });
  runCommand("git", ["-C", path.join(scenario.workspace, "src/api"), "add", "openspec/config.yaml"]);
  const second = await connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner });

  assert.equal(first.status, "ready");
  assert.equal(first.repositories[0].cloned, true);
  assert.equal(second.status, "ready");
  assert.equal(second.repositories[0].cloned, false);
  assert.equal(second.repositories[0].pointerCreated, false);
});

test("connectProject remembers an explicit workspace for a nonstandard Store path", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const customStoreRoot = path.join(scenario.root, "custom-store");
  await fs.rename(scenario.storeRoot, customStoreRoot);
  const openSpec = fakeOpenSpec(customStoreRoot);

  const first = await connectProject({
    start: customStoreRoot,
    workspace: scenario.workspace,
    commandRunner: openSpec.runner,
  });
  const second = await connectProject({ start: customStoreRoot, commandRunner: openSpec.runner });

  assert.equal(first.workspace, scenario.workspace);
  assert.equal(second.workspace, scenario.workspace);
  assert.equal(
    runCommand("git", ["-C", customStoreRoot, "config", "--local", "--get", "openspec-orch.workspace"]),
    scenario.workspace,
  );
});

test("connectProject does not infer workspace from the legacy openspec container", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const legacyStoreRoot = path.join(scenario.workspace, "openspec", "payments-specs");
  await fs.mkdir(path.dirname(legacyStoreRoot), { recursive: true });
  await fs.rename(scenario.storeRoot, legacyStoreRoot);
  const openSpec = fakeOpenSpec(legacyStoreRoot);

  await assert.rejects(
    connectProject({ start: legacyStoreRoot, commandRunner: openSpec.runner }),
  );
});

for (const agent of [QWEN_AGENT, GIGACODE_AGENT]) {
  test(`connectProject requires agent.instructions_file for ${agent.id}`, async (t) => {
    const scenario = await createScenario(t, { pointer: true, agent });
    const missing = path.join(scenario.storeRoot, agent.instructionsFile);
    await fs.rm(missing);
    const openSpec = fakeOpenSpec(scenario.storeRoot);

    await assert.rejects(
      connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner }),
    );
    assert.deepEqual(openSpec.calls, []);
  });
}

test("connectProject requires the non-command Explore instructions", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  await fs.rm(path.join(scenario.storeRoot, ".sdd", "instructions", "explore.md"));
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner }),
  );
  assert.deepEqual(openSpec.calls, []);
});

test("connectProject keeps an uncommitted generated pointer as needs_setup_pr", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  const first = await connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner });
  const second = await connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner });

  assert.equal(first.status, "needs_setup_pr");
  assert.equal(second.status, "needs_setup_pr");
  assert.equal(second.repositories[0].pointerCreated, false);
  assert.equal(second.repositories[0].pointerPending, true);
});

test("connectProject rejects an invalid Git revision", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (command === "git" && args.join(" ") === "rev-parse HEAD") return "not-a-sha";
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: runner }),
  );
});

test("connectProject blocks an OpenSpec diagnostic returned in JSON", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (command === "openspec" && args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [],
        status: [{ severity: "error", code: "broken_store", message: "Store повреждён" }],
      });
    }
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: runner }),
  );
});

test("connectProject preserves and blocks a dirty existing Code Repository", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner });
  const checkout = path.join(scenario.workspace, "src", "api");
  await fs.writeFile(path.join(checkout, "local.txt"), "do not touch\n", "utf8");

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner }),
  );
  assert.equal(await fs.readFile(path.join(checkout, "local.txt"), "utf8"), "do not touch\n");
});

test("connectProject refuses a registry conflict without unregistering it", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const conflictingPath = path.join(scenario.root, "other-checkout");
  const openSpec = fakeOpenSpec(scenario.storeRoot, [
    { id: "payments-specs", root: conflictingPath },
  ]);

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner }),
  );
  assert.equal(
    openSpec.calls.some(({ args }) => args[0] === "store" && args[1] === "unregister"),
    false,
  );
  assert.equal(fsSync.existsSync(path.join(scenario.workspace, "src")), false);
});

test("connectProject validates Store ID before changing the local registry", async (t) => {
  const scenario = await createScenario(t, { pointer: true });
  const metadataPath = path.join(scenario.storeRoot, ".openspec-store", "store.yaml");
  await fs.writeFile(
    metadataPath,
    `version: 1\nid: another-store\nremote: ${JSON.stringify(scenario.centralRemote)}\n`,
  );
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    connectProject({ start: scenario.storeRoot, commandRunner: openSpec.runner }),
  );
  assert.deepEqual(openSpec.calls, []);
});
