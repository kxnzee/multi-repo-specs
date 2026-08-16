/** @fileoverview Интеграционные сценарии подключения Store и Code Repositories. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { connectProject } from "../src/internal/connect/index.js";
import { serializeOrchestratorConfig } from "../src/internal/config/index.js";
import { runCommand } from "../src/internal/shared/command.js";
import { parseTemplateDescriptor } from "../src/internal/template/index.js";
import {
  commitFiles,
  createBareRemote,
  initializeGitRepository,
  temporaryDirectory,
} from "../test-fixtures/workspace.js";

const BASE_TEMPLATE_ROOT = new URL("../templates/base/", import.meta.url);
const BASE_TEMPLATE_DESCRIPTOR = parseTemplateDescriptor(
  await fs.readFile(new URL("template.yaml", BASE_TEMPLATE_ROOT), "utf8"),
);
const BASE_AGENTS = Object.freeze(
  Object.values(BASE_TEMPLATE_DESCRIPTOR.agents).sort(({ id: left }, { id: right }) =>
    left.localeCompare(right)),
);
const DEFAULT_AGENT = BASE_AGENTS[0];
const REMOTE_FIXTURES = new Map();

/**
 * Собирает центральный Store, Code remote и локальный workspace для connect-тестов.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @param {{pointer?: boolean, agent?: (typeof BASE_AGENTS)[number]}} [options]
 * Нужно ли заранее принять project pointer и какой adapter записать в Store.
 * @returns {Promise<{
 *   root: string,
 *   workspace: string,
 *   storeRoot: string,
 *   centralRemote: string,
 *   codeRemote: string
 * }>} Пути подготовленного сценария.
 */
async function createScenario(t, { pointer = false, agent = DEFAULT_AGENT } = {}) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-connect-");
  const codeFiles = pointer ? { "openspec/config.yaml": "store: payments-specs\n" } : {};
  const codeRemotePath = await createBareRemote(root, "api", codeFiles);
  const fixtureId = path.basename(root);
  const codeRemote = `https://example.test/${fixtureId}/api.git`;
  const centralSource = path.join(root, "central-source");
  await initializeGitRepository(centralSource);

  const centralRemotePath = path.join(root, "payments-specs.git");
  const centralRemote = `https://example.test/${fixtureId}/payments-specs.git`;
  const orchestratorTemplate = "version: 1\nstrict: true\n\nrepositories: []\n\nextensions: {}\n";
  const centralFiles = {
    ".openspec-store/store.yaml": `version: 1\nid: payments-specs\nremote: ${JSON.stringify(centralRemote)}\n`,
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/specs/.gitkeep": "",
    "openspec/changes/.gitkeep": "",
    [path.join(agent.commandsDirectory, "opsx-continue.md")]: "---\ndescription: continue\n---\n",
    [path.join(agent.commandsDirectory, "opsx-explore.md")]: "---\ndescription: explore\n---\n",
    [path.join(agent.commandsDirectory, "opsx-update.md")]: "---\ndescription: update\n---\n",
    [agent.instructionsFile]: `# Instructions for ${agent.id}\n`,
    "openspec-orch.yaml": serializeOrchestratorConfig(orchestratorTemplate, [
      {
        id: "payments-specs",
        role: "store",
        remote: centralRemote,
        defaultBranch: "main",
      },
      { id: "api", role: "code", remote: codeRemote, defaultBranch: "main" },
    ]),
  };
  await commitFiles(centralSource, centralFiles, { message: "initialize store" });
  await runCommand("git", ["clone", "--bare", centralSource, centralRemotePath]);

  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(workspace, "payments-specs");
  await fs.mkdir(workspace, { recursive: true });
  await runCommand("git", ["clone", centralRemotePath, storeRoot]);
  await runCommand("git", ["-C", storeRoot, "remote", "set-url", "origin", centralRemote]);
  REMOTE_FIXTURES.set(codeRemote, codeRemotePath);
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
    if (command === "git") {
      const separator = args.indexOf("--");
      const remote = separator >= 0 ? args[separator + 1] : undefined;
      const localRemote = REMOTE_FIXTURES.get(remote);
      if (localRemote && args[0] === "clone") {
        const target = args[separator + 2];
        const localArgs = [...args];
        localArgs[separator + 1] = localRemote;
        return runCommand(command, localArgs, options).then(async (output) => {
          await runCommand("git", ["-C", target, "remote", "set-url", "origin", remote]);
          return output;
        });
      }
      return runCommand(command, args, options);
    }
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
    (await runCommand("git", ["-C", path.join(scenario.workspace, "src/api"), "status", "--porcelain"]))
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
  await runCommand("git", ["-C", path.join(scenario.workspace, "src/api"), "add", "openspec/config.yaml"]);
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
  const state = JSON.parse(
    await fs.readFile(path.join(customStoreRoot, ".openspec-orch", "state.json"), "utf8"),
  );
  assert.deepEqual(state, {
    contract_version: 1,
    workspace: scenario.workspace,
    result_receipts: [],
    result_receipt_history: [],
    snapshots: [],
    verification_receipts: [],
    verification_receipt_history: [],
  });
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

for (const agent of BASE_AGENTS) {
  test(`connectProject does not require Template bootstrap assets for ${agent.id}`, async (t) => {
    const scenario = await createScenario(t, { pointer: true, agent });
    await fs.rm(path.join(scenario.storeRoot, agent.instructionsFile));
    await fs.rm(path.join(scenario.storeRoot, agent.commandsDirectory), { recursive: true });
    assert.equal(fsSync.existsSync(path.join(scenario.storeRoot, ".sdd")), false);
    const openSpec = fakeOpenSpec(scenario.storeRoot);

    const result = await connectProject({
      start: scenario.storeRoot,
      commandRunner: openSpec.runner,
    });
    assert.equal(result.status, "ready");
    assert.notEqual(openSpec.calls.length, 0);
  });
}

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

test("connectProject relaxed mode uses existing local directories without Git assumptions", async (t) => {
  const scenario = await createScenario(t);
  const checkout = path.join(scenario.workspace, "src", "api");
  await fs.mkdir(checkout, { recursive: true });
  await fs.writeFile(path.join(checkout, "local.txt"), "not a Git checkout\n", "utf8");
  const configPath = path.join(scenario.storeRoot, "openspec-orch.yaml");
  await fs.writeFile(
    configPath,
    (await fs.readFile(configPath, "utf8")).replace("strict: true", "strict: false"),
    "utf8",
  );
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  const result = await connectProject({
    start: scenario.storeRoot,
    workspace: scenario.workspace,
    commandRunner: openSpec.runner,
  });

  assert.equal(result.executionMode, "relaxed");
  assert.equal(result.repositories[0].cloned, false);
  assert.equal(result.repositories[0].branch, "unpinned");
  assert.equal(result.repositories[0].revision, "unpinned");
  assert.equal(result.repositories[0].pointerPending, false);
  assert.equal(
    await fs.readFile(path.join(checkout, "openspec", "config.yaml"), "utf8"),
    "store: payments-specs\n",
  );
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
