/** @fileoverview Интеграционные сценарии однократной инициализации Store. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveAgentAdapter } from "../config/agents.js";
import { assertSupportedOpenSpecVersion, parseOrchestratorConfig } from "../config/index.js";
import { initProject, parseRepository } from "../init/index.js";
import { runCommand } from "../shared/command.js";

/**
 * Создаёт тестовый центральный Git-репозиторий с origin.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь временного проекта.
 */
async function temporaryProject(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-init-"));
  const canonicalDirectory = await fs.realpath(directory);
  t.after(async () => fs.rm(canonicalDirectory, { recursive: true, force: true }));
  runCommand("git", ["init", "--initial-branch", "main", canonicalDirectory]);
  runCommand("git", ["-C", canonicalDirectory, "remote", "add", "origin", "https://example.test/specs.git"]);
  return canonicalDirectory;
}

/**
 * Перечисляет созданные init обычные файлы вне служебного каталога Git.
 *
 * @param {string} root Корень тестового Store.
 * @param {string} [relativeDirectory] Текущий относительный каталог.
 * @returns {Promise<string[]>} Отсортированные POSIX-пути.
 */
async function listProjectFiles(root, relativeDirectory = "") {
  const entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!relativeDirectory && entry.name === ".git") continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await listProjectFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath.split(path.sep).join("/"));
  }
  return files.sort();
}

const COMMON_INIT_FILES = Object.freeze([
  ".gitignore",
  ".openspec-store/store.yaml",
  ".openspec-orch/instructions/explore.md",
  "CODEOWNERS",
  "openspec/config.yaml",
  "openspec/context/00-start-here.md",
  "openspec/context/01-product-context.md",
  "openspec/context/02-domain-glossary.md",
  "openspec/context/03-architecture.md",
  "openspec/context/04-domain-model.md",
  "openspec/context/05-security-and-compliance.md",
  "openspec/context/06-cross-system-invariants.md",
  "openspec/context/07-quality-gates.md",
  "openspec/context/08-release-process.md",
  "openspec/context/ADR/README.md",
  "openspec/context/_raw/README.md",
  "openspec/context/system-map.yaml",
  "openspec-orch.yaml",
]);

const PROJECT_COMMANDS = Object.freeze([
  "opsx-continue.md",
  "opsx-explore.md",
  "opsx-update.md",
  "openspec-orch-apply.md",
  "openspec-orch-change.md",
  "openspec-orch-context.md",
]);

const PROJECT_SUBAGENTS = Object.freeze([
  "backend-context-pass.md",
  "frontend-context-pass.md",
  "repository-context-pass.md",
]);

/**
 * Имитирует OpenSpec init и Store API для тестов `openspec-orch init`.
 *
 * @param {string} projectRoot Корень тестового проекта.
 * @returns {{calls: string[][], runner: typeof runCommand}} Тестовый runner и журнал аргументов.
 */
function fakeOpenSpec(projectRoot, { registeredStoreId } = {}) {
  const calls = [];
  let storeId = registeredStoreId;
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push(args);

    if (args.join(" ") === "--version") return "1.7.0";
    if (args[0] === "store" && args[1] === "setup") {
      storeId = args[2];
      const remote = args[args.indexOf("--remote") + 1];
      fsSync.mkdirSync(path.join(projectRoot, ".openspec-store"), { recursive: true });
      fsSync.mkdirSync(path.join(projectRoot, "openspec", "specs"), { recursive: true });
      fsSync.mkdirSync(path.join(projectRoot, "openspec", "changes", "archive"), {
        recursive: true,
      });
      fsSync.writeFileSync(
        path.join(projectRoot, ".openspec-store", "store.yaml"),
        `version: 1\nid: ${storeId}\nremote: ${JSON.stringify(remote)}\n`,
      );
      fsSync.writeFileSync(
        path.join(projectRoot, "openspec", "config.yaml"),
        "schema: spec-driven\n",
      );
      return JSON.stringify({
        store: { id: storeId, root: projectRoot },
        registry: { registered: true, already_registered: false },
        git: { is_repository: true, initialized: false, committed: false },
        created_files: [],
        status: [],
      });
    }
    if (args[0] === "init") {
      assert.equal(args[args.indexOf("--profile") + 1], "custom");
      const profileRoot = options.environment?.XDG_CONFIG_HOME;
      assert.equal(typeof profileRoot, "string");
      const profile = JSON.parse(
        fsSync.readFileSync(path.join(profileRoot, "openspec", "config.json"), "utf8"),
      );
      assert.equal(profile.profile, "custom");
      assert.equal(profile.delivery, "both");
      assert.deepEqual(profile.workflows, [
        "propose",
        "explore",
        "new",
        "continue",
        "apply",
        "update",
        "ff",
        "sync",
        "archive",
        "bulk-archive",
        "verify",
        "onboard",
      ]);
      const agent = resolveAgentAdapter(args[args.indexOf("--tools") + 1]);
      fsSync.mkdirSync(path.join(projectRoot, agent.commandsDirectory), { recursive: true });
      for (const action of ["explore", "continue", "update"]) {
        fsSync.writeFileSync(
          path.join(projectRoot, agent.commandsDirectory, `opsx-${action}.md`),
          "original OpenSpec action\n",
        );
      }
      return "initialized";
    }
    if (args.join(" ") === "store list --json") {
      return JSON.stringify({
        stores: storeId ? [{ id: storeId, root: projectRoot }] : [],
        status: [],
      });
    }
    if (args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [
          {
            id: storeId,
            root: projectRoot,
            metadata: { present: true, valid: true },
            openspec_root: { present: true, healthy: true, status: [] },
            status: [],
          },
        ],
        status: [],
      });
    }
    if (args[0] === "doctor") {
      return JSON.stringify({
        root: { path: projectRoot, source: "store", store_id: storeId, healthy: true, status: [] },
        store: { id: storeId, status: [] },
        references: [],
        status: [],
      });
    }
    if (args[0] === "context") {
      return JSON.stringify({
        root: { path: projectRoot, source: "store", store_id: storeId, role: "openspec_root" },
        members: [],
        status: [],
      });
    }
    throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
  };
  return { calls, runner };
}

test("parseRepository accepts the documented id=url#branch format", () => {
  assert.deepEqual(parseRepository("ui=https://example.test/ui.git#main"), {
    id: "ui",
    role: "code",
    url: "https://example.test/ui.git",
    defaultBranch: "main",
  });
});

test("parseRepository rejects ambiguous repository input", () => {
  assert.throws(() => parseRepository("UI=https://example.test/ui.git#main"));
  assert.throws(() => parseRepository("ui=https://example.test/ui.git"));
});

test("initProject creates Store, official expanded pack and the complete skeleton", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    repositories: [parseRepository("ui=https://example.test/ui.git#main")],
    commandRunner: openSpec.runner,
  });

  assert.equal(result.alreadyInitialized, false);
  assert.ok(
    openSpec.calls.some(
      (args) =>
        args[0] === "store" &&
        args[1] === "setup" &&
        args.includes("--no-init-git") &&
        args.includes("--remote"),
    ),
  );
  assert.ok(
    openSpec.calls.some(
      (args) => args[0] === "init" && args.includes("qwen") && args.includes("custom"),
    ),
  );

  const expectedMachineFiles = [
    ".openspec-store/store.yaml",
    "openspec/config.yaml",
    "openspec/context/system-map.yaml",
    "openspec-orch.yaml",
    "CODEOWNERS",
    ".gitignore",
  ];
  for (const relativePath of expectedMachineFiles) {
    assert.equal((await fs.stat(path.join(target, relativePath))).isFile(), true, relativePath);
  }
  const config = parseOrchestratorConfig(await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"));
  assert.deepEqual(config.storeRepository, {
    id: "payments-specs",
    role: "store",
    url: "https://example.test/specs.git",
    defaultBranch: "main",
  });
  assert.deepEqual(config.codeRepositories.map(({ id }) => id), ["ui"]);
  assert.equal((await fs.stat(path.join(target, config.agent.commandsDirectory))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.agentsDirectory))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.instructionsFile))).isFile(), true);
});

test("initProject persists the selected adapter after OpenSpec initialization", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);

  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "gigacode",
    commandRunner: openSpec.runner,
  });

  const config = parseOrchestratorConfig(await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"));
  assert.deepEqual(config.agent, resolveAgentAdapter("gigacode"));
  assert.equal((await fs.stat(path.join(target, config.agent.commandsDirectory))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.agentsDirectory))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.instructionsFile))).isFile(), true);
  assert.equal(fsSync.existsSync(path.join(target, resolveAgentAdapter("qwen").commandsDirectory)), false);
  assert.ok(
    openSpec.calls.some(
      (args) => args[0] === "init" && args[args.indexOf("--tools") + 1] === "qwen",
    ),
  );
});

test("initProject preserves the complete public file tree for every supported agent", async (t) => {
  for (const agentId of ["qwen", "gigacode"]) {
    const target = await temporaryProject(t);
    const openSpec = fakeOpenSpec(target);
    await initProject({
      target,
      storeId: `${agentId}-specs`,
      agentId,
      commandRunner: openSpec.runner,
    });

    const agentRoot = agentId === "qwen" ? ".qwen" : ".gigacode";
    const instructionFile = agentId === "qwen" ? "QWEN.md" : ".gigacode/GIGACODE.md";
    const expected = [
      ...COMMON_INIT_FILES,
      ...PROJECT_COMMANDS.map((name) => `${agentRoot}/commands/${name}`),
      ...PROJECT_SUBAGENTS.map((name) => `${agentRoot}/agents/${name}`),
      instructionFile,
    ].sort();
    assert.deepEqual(await listProjectFiles(target), expected, agentId);
  }
});

test("initProject refuses a dirty repository before invoking OpenSpec", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "user-change.txt"), "dirty\n", "utf8");
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(fsSync.existsSync(path.join(target, ".openspec-store")), false);
});

test("initProject does not mutate a path with an existing Store registration", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target, { registeredStoreId: "rum-specs" });

  await assert.rejects(
    initProject({
      target,
      storeId: "test-store",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(
    openSpec.calls.some((args) => args[0] === "store" && args[1] === "setup"),
    false,
  );
  assert.equal(fsSync.existsSync(path.join(target, ".openspec-store")), false);
  assert.equal(fsSync.existsSync(path.join(target, ".qwen")), false);
  assert.equal(fsSync.existsSync(path.join(target, "openspec")), false);
});

test("initProject reports recovery for Store metadata without the remaining initialization", async (t) => {
  const target = await temporaryProject(t);
  await fs.mkdir(path.join(target, ".openspec-store"));
  await fs.writeFile(
    path.join(target, ".openspec-store", "store.yaml"),
    'version: 1\nid: payments-specs\nremote: "https://example.test/specs.git"\n',
  );
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
  );
  assert.deepEqual(openSpec.calls, []);
  await assert.rejects(fs.stat(path.join(target, "openspec-orch.yaml")));
});

test("initProject rejects existing Store metadata with another ID", async (t) => {
  const target = await temporaryProject(t);
  await fs.mkdir(path.join(target, ".openspec-store"));
  await fs.writeFile(
    path.join(target, ".openspec-store", "store.yaml"),
    'version: 1\nid: another-store\nremote: "https://example.test/specs.git"\n',
  );

  await assert.rejects(
    initProject({ target, storeId: "payments-specs", agentId: "qwen" }),
  );
});

test("OpenSpec Orchestrator accepts only OpenSpec 1.7.0", () => {
  assert.equal(assertSupportedOpenSpecVersion("1.7.0"), "1.7.0");
  assert.throws(() => assertSupportedOpenSpecVersion("1.7.1"));
  assert.throws(() => assertSupportedOpenSpecVersion("1.8.0"));
});

test("initProject does not modify a complete initialized Store", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  const callsBeforeRepeat = openSpec.calls.length;

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
  assert.deepEqual(result.created, []);
  assert.equal(openSpec.calls.length, callsBeforeRepeat);
});

test("initProject reports recovery when a completed Store loses Explore instructions", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  const callsBeforeRepeat = openSpec.calls.length;
  const missingInstructions = path.join(target, ".openspec-orch", "instructions", "explore.md");
  await fs.unlink(missingInstructions);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(openSpec.calls.length, callsBeforeRepeat);
  await assert.rejects(fs.stat(missingInstructions));
});

test("initProject blocks conflicting skeleton paths instead of overwriting them", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "openspec-orch.yaml"), "user owned\n", "utf8");
  runCommand("git", ["-C", target, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", target, "config", "user.name", "OpenSpec Orchestrator Tests"]);
  runCommand("git", ["-C", target, "add", "openspec-orch.yaml"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"), "user owned\n");
});

test("initProject preserves and extends existing gitignore and CODEOWNERS", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, ".gitignore"), "node_modules/\n.openspec-orch/cache/\n", "utf8");
  await fs.writeFile(path.join(target, "CODEOWNERS"), "* @existing-team\n", "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", ".gitignore", "CODEOWNERS"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project files"]);
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });

  const gitIgnore = await fs.readFile(path.join(target, ".gitignore"), "utf8");
  const ignoredPaths = gitIgnore.trim().split("\n");
  assert.equal(ignoredPaths.includes("node_modules/"), true);
  assert.equal(ignoredPaths.filter((entry) => entry === ".openspec-orch/cache/").length, 1);
  assert.equal(ignoredPaths.includes(".openspec-orch/logs/"), true);
  assert.equal(ignoredPaths.includes(".openspec-orch/credentials/"), true);
  assert.equal(ignoredPaths.includes(".openspec-orch/checkouts/"), false);

  const codeOwners = await fs.readFile(path.join(target, "CODEOWNERS"), "utf8");
  const ownershipRules = codeOwners.trim().split("\n");
  assert.equal(ownershipRules.includes("* @existing-team"), true);
  assert.equal(ownershipRules.includes("# /openspec/specs/** @spec-owner"), true);
  assert.deepEqual(result.updated.sort(), [".gitignore", "CODEOWNERS", "openspec/config.yaml"]);
  assert.equal(result.created.includes(".gitignore"), false);
  assert.equal(result.created.includes("CODEOWNERS"), false);
});

test("initProject adopts a non-empty central repository through the official OpenSpec root", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "existing.txt"), "existing project\n", "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", "existing.txt"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });

  const initIndex = openSpec.calls.findIndex((args) => args[0] === "init");
  const setupIndex = openSpec.calls.findIndex(
    (args) => args[0] === "store" && args[1] === "setup",
  );
  assert.ok(initIndex >= 0 && setupIndex > initIndex);
  assert.equal(await fs.readFile(path.join(target, "existing.txt"), "utf8"), "existing project\n");
});

/**
 * Настраивает локальную Git identity для тестовых коммитов.
 *
 * @param {string} repository Путь тестового Git-репозитория.
 * @returns {void}
 */
function configureRepository(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "OpenSpec Orchestrator Tests"]);
}
