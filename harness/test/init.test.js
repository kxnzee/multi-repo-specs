/** @fileoverview Интеграционные сценарии однократной инициализации Store. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { parseOrchestratorConfig } from "../config/index.js";
import { initProject, parseRepository } from "../init/index.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli, requireOpenSpecCapability } from "../shared/compatibility.js";
import { agentFixture } from "../test-fixtures/agents.js";

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
  ".sdd/instructions/explore.md",
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
  "sdd-apply.md",
  "sdd-change.md",
  "sdd-context.md",
]);

const PROJECT_SUBAGENTS = Object.freeze([
  "backend-context-pass.md",
  "frontend-context-pass.md",
  "repository-context-pass.md",
]);

const BASE_TEMPLATE_ROOT = new URL("../templates/base/", import.meta.url);

/**
 * Создаёт минимальный пользовательский Template с новым agent mapping.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @returns {Promise<string>} Путь Template root.
 */
async function customTemplate(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-custom-template-")),
  );
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const files = {
    "template.yaml": `agents:
  team-agent:
    openspec_adapter: qwen
    generated_directory: .qwen
    target_directory: .team-agent
    commands_directory: .team-agent/actions
    instructions_file: TEAM.md
    handoffs:
      apply: .team-agent/actions/team-apply.md
    copy:
      - from: skeleton
        to: .
      - from: commands
        to: .team-agent/actions
      - from: TEAM.md
        to: TEAM.md
`,
    "skeleton/openspec/config.yaml": "schema: team-custom\n",
    "skeleton/team-required.txt": "custom project asset\n",
    "commands/team-apply.md": "# Team apply\n",
    "TEAM.md": "# Team agent instructions\n",
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  return root;
}

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
      const adapter = args[args.indexOf("--tools") + 1];
      assert.equal(adapter, "qwen");
      const commandsDirectory = ".qwen/commands";
      fsSync.mkdirSync(path.join(projectRoot, commandsDirectory), { recursive: true });
      for (const action of ["explore", "continue", "update"]) {
        fsSync.writeFileSync(
          path.join(projectRoot, commandsDirectory, `opsx-${action}.md`),
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

test("base Project Template owns workflow assets but not Core configuration", async () => {
  const descriptor = parse(
    await fs.readFile(new URL("template.yaml", BASE_TEMPLATE_ROOT), "utf8"),
  );
  assert.deepEqual(Object.keys(descriptor.agents).sort(), ["gigacode", "qwen"]);
  assert.deepEqual(descriptor.agents.qwen.handoffs, {
    explore: ".sdd/instructions/explore.md",
    apply: ".qwen/commands/sdd-apply.md",
  });
  assert.deepEqual(descriptor.agents.gigacode.handoffs, {
    explore: ".sdd/instructions/explore.md",
    apply: ".gigacode/commands/sdd-apply.md",
  });

  for (const relativePath of [
    "skeleton/openspec/config.yaml",
    "commands/sdd-context.md",
    "commands/sdd-change.md",
    "commands/sdd-apply.md",
    "subagents/repository-context-pass.md",
    "agents/qwen/QWEN.md",
    "agents/gigacode/.gigacode/GIGACODE.md",
  ]) {
    assert.equal((await fs.stat(new URL(relativePath, BASE_TEMPLATE_ROOT))).isFile(), true);
  }
  await assert.rejects(
    fs.stat(new URL("skeleton/openspec-orch.yaml", BASE_TEMPLATE_ROOT)),
    { code: "ENOENT" },
  );
  assert.equal(
    (await fs.stat(new URL("../init/openspec-orch.yaml", import.meta.url))).isFile(),
    true,
  );
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
  assert.equal((await fs.stat(path.join(target, ".qwen", "agents"))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.instructionsFile))).isFile(), true);
});

test("initProject persists relaxed mode only when it is explicitly requested", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    noStrict: true,
    commandRunner: openSpec.runner,
  });
  const config = parseOrchestratorConfig(
    await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"),
  );
  assert.equal(result.executionMode, "relaxed");
  assert.equal(config.strict, false);
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
  const selected = agentFixture("gigacode");
  assert.deepEqual(config.agent, {
    id: selected.id,
    openSpecId: selected.openSpecId,
    architecture: selected.architecture,
    commandsDirectory: selected.commandsDirectory,
    instructionsFile: selected.instructionsFile,
    handoffs: selected.handoffs,
  });
  assert.equal((await fs.stat(path.join(target, config.agent.commandsDirectory))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, ".gigacode", "agents"))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(target, config.agent.instructionsFile))).isFile(), true);
  assert.equal(fsSync.existsSync(path.join(target, ".qwen")), false);
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

test("OpenSpec compatibility accepts semantic versions and reports missing capabilities", () => {
  for (const version of ["1.7.0", "1.7.1", "1.8.0", "2.0.0-beta.1"]) {
    assert.equal(inspectOpenSpecCli(() => version, "/tmp"), version);
  }
  assert.throws(() => inspectOpenSpecCli(() => "OpenSpec dev", "/tmp"), /semantic version/);
  assert.throws(
    () => requireOpenSpecCapability(false, "openspec store list --json: stores[]"),
    /обязательный capability.*stores\[\]/,
  );
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

test("initProject does not require an optional handoff file on successful repeat", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  const callsBeforeRepeat = openSpec.calls.length;
  const missingInstructions = path.join(target, ".sdd", "instructions", "explore.md");
  await fs.unlink(missingInstructions);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
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

test("initProject rejects differing pre-existing Template files without merging them", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, ".gitignore"), "node_modules/\n.openspec-orch/cache/\n", "utf8");
  await fs.writeFile(path.join(target, "CODEOWNERS"), "* @existing-team\n", "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", ".gitignore", "CODEOWNERS"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project files"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
    /существующий файл с другим содержимым/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(await fs.readFile(path.join(target, "CODEOWNERS"), "utf8"), "* @existing-team\n");
});

test("initProject applies a custom Template and persists its runtime agent mapping", async (t) => {
  const target = await temporaryProject(t);
  const templateRoot = await customTemplate(t);
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "team-agent",
    templateRoot,
    commandRunner: openSpec.runner,
  });

  assert.equal(result.alreadyInitialized, false);
  assert.equal(await fs.readFile(path.join(target, "openspec", "config.yaml"), "utf8"), "schema: team-custom\n");
  assert.equal(await fs.readFile(path.join(target, "team-required.txt"), "utf8"), "custom project asset\n");
  assert.equal(fsSync.existsSync(path.join(target, "CODEOWNERS")), false);
  assert.equal(fsSync.existsSync(path.join(target, ".sdd")), false);
  assert.equal(fsSync.existsSync(path.join(target, ".qwen")), false);
  assert.equal((await fs.stat(path.join(target, ".team-agent", "actions"))).isDirectory(), true);

  const config = parseOrchestratorConfig(
    await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(config.agent, {
    id: "team-agent",
    openSpecId: "qwen",
    architecture: "markdown-commands",
    commandsDirectory: ".team-agent/actions",
    instructionsFile: "TEAM.md",
    handoffs: { apply: ".team-agent/actions/team-apply.md" },
  });

  const repeat = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "team-agent",
    commandRunner: openSpec.runner,
  });
  assert.equal(repeat.alreadyInitialized, true);
});

test("initProject rejects an agent absent from the selected Template before OpenSpec calls", async (t) => {
  const target = await temporaryProject(t);
  const templateRoot = await customTemplate(t);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      templateRoot,
      commandRunner: openSpec.runner,
    }),
    /Template не поддерживает agent 'qwen'/,
  );
  assert.deepEqual(openSpec.calls, []);
});

test("initProject skips an identical file that existed before the run", async (t) => {
  const target = await temporaryProject(t);
  const gitIgnore = await fs.readFile(
    new URL("assets/gitignore.template", BASE_TEMPLATE_ROOT),
    "utf8",
  );
  await fs.writeFile(path.join(target, ".gitignore"), gitIgnore, "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", ".gitignore"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing identical template file"]);
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });

  assert.equal(result.created.includes(".gitignore"), false);
  assert.equal(result.updated.includes(".gitignore"), false);
  assert.equal(await fs.readFile(path.join(target, ".gitignore"), "utf8"), gitIgnore);
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
