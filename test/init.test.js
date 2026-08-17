/** @fileoverview Интеграционные сценарии однократной инициализации Store. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { parseOrchestratorConfig } from "../src/internal/config/index.js";
import { initProject, parseRepository } from "../src/internal/init/index.js";
import { runCommand } from "../src/internal/shared/command.js";
import { inspectOpenSpecCli, requireOpenSpecCapability } from "../src/internal/shared/compatibility.js";
import { parseTemplateDescriptor } from "../src/internal/template/index.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

/**
 * Создаёт тестовый центральный Git-репозиторий с origin.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь временного проекта.
 */
async function temporaryProject(t) {
  const canonicalDirectory = await temporaryDirectory(t, "openspec-orchestrator-init-");
  await runCommand("git", ["init", "--initial-branch", "main", canonicalDirectory]);
  await runCommand("git", ["-C", canonicalDirectory, "remote", "add", "origin", "https://example.test/specs.git"]);
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
  "openspec/context/repositories/README.md",
  "openspec/context/system-map.yaml",
  "openspec-orch.yaml",
]);

const OPEN_SPEC_COMMANDS = Object.freeze([
  "opsx-continue.md",
  "opsx-explore.md",
  "opsx-update.md",
]);

const PROJECT_COMMANDS = Object.freeze(["openspec-context.md"]);

const PROJECT_SKILLS = Object.freeze([
  "openspec-analyze-impact/SKILL.md",
  "openspec-review-change/SKILL.md",
  "openspec-test-cases/SKILL.md",
]);

const PROJECT_SUBAGENTS = Object.freeze([
  "openspec-architecture-impact-reviewer.md",
  "openspec-implementation-scout.md",
  "openspec-project-context-researcher.md",
  "openspec-specification-reviewer.md",
  "openspec-verification-reviewer.md",
]);

const BASE_TEMPLATE_ROOT = new URL("../templates/base/", import.meta.url);
const BASE_TEMPLATE_DESCRIPTOR = parseTemplateDescriptor(
  await fs.readFile(new URL("template.yaml", BASE_TEMPLATE_ROOT), "utf8"),
);
const BASE_AGENT_IDS = Object.freeze(Object.keys(BASE_TEMPLATE_DESCRIPTOR.agents).sort());
const DEFAULT_AGENT_ID = BASE_AGENT_IDS[0];
const DEFAULT_AGENT = BASE_TEMPLATE_DESCRIPTOR.agents[DEFAULT_AGENT_ID];
const RELOCATED_AGENT = Object.values(BASE_TEMPLATE_DESCRIPTOR.agents)
  .find(({ generatedDirectory, targetDirectory }) => generatedDirectory !== targetDirectory);

/**
 * Создаёт минимальный пользовательский Template с новым agent mapping.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @returns {Promise<string>} Путь Template root.
 */
async function customTemplate(t) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-custom-template-");
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
      - from: project-files
        to: .
      - from: commands
        to: .team-agent/actions
      - from: TEAM.md
        to: TEAM.md
`,
    "project-files/openspec/config.yaml": "schema: team-custom\n",
    "project-files/team-required.txt": "custom project asset\n",
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
      const matchingAgents = Object.values(BASE_TEMPLATE_DESCRIPTOR.agents)
        .filter(({ openSpecId }) => openSpecId === adapter);
      assert.notEqual(matchingAgents.length, 0, adapter);
      const generatedCommandDirectories = new Set(
        matchingAgents.map((agent) => path.posix.join(
          agent.generatedDirectory,
          path.posix.relative(agent.targetDirectory, agent.commandsDirectory),
        )),
      );
      assert.equal(generatedCommandDirectories.size, 1, adapter);
      const [commandsDirectory] = generatedCommandDirectories;
      fsSync.mkdirSync(path.join(projectRoot, commandsDirectory), { recursive: true });
      for (const filename of OPEN_SPEC_COMMANDS) {
        fsSync.writeFileSync(
          path.join(projectRoot, commandsDirectory, filename),
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

test("parseRepository accepts the documented id=remote#branch format", () => {
  assert.deepEqual(parseRepository("ui=https://example.test/ui.git#main"), {
    id: "ui",
    role: "code",
    remote: "https://example.test/ui.git",
    defaultBranch: "main",
  });
});

test("parseRepository rejects ambiguous repository input", () => {
  assert.throws(() => parseRepository("UI=https://example.test/ui.git#main"));
  assert.throws(() => parseRepository("ui=https://example.test/ui.git"));
  assert.throws(() => parseRepository("ui=/private/tmp/ui.git#main"), /CONFIG_INVALID/);
});

test("base Project Template owns only focused bootstrap assets", async () => {
  assert.notEqual(BASE_AGENT_IDS.length, 0);
  for (const agent of Object.values(BASE_TEMPLATE_DESCRIPTOR.agents)) {
    assert.deepEqual(agent.handoffs, {});
  }

  for (const relativePath of [
    "assets/gitignore.template",
    "context/00-start-here.md",
    "openspec/config.yaml",
    "context/repositories/README.md",
    "context/system-map.yaml",
    "commands/openspec-context.md",
    "skills/openspec-analyze-impact/SKILL.md",
    "skills/openspec-review-change/SKILL.md",
    "skills/openspec-test-cases/SKILL.md",
    "subagents/openspec-project-context-researcher.md",
    "agent-instructions.md",
  ]) {
    assert.equal((await fs.stat(new URL(relativePath, BASE_TEMPLATE_ROOT))).isFile(), true);
  }
  await assert.rejects(
    fs.stat(new URL("openspec-orch.yaml", BASE_TEMPLATE_ROOT)),
    { code: "ENOENT" },
  );
  assert.equal(
    (await fs.stat(new URL("../src/internal/init/openspec-orch.yaml", import.meta.url))).isFile(),
    true,
  );
});

test("initProject creates Store, official expanded pack and minimal base assets", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
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
      (args) =>
        args[0] === "init" &&
        args.includes(DEFAULT_AGENT.openSpecId) &&
        args.includes("custom"),
    ),
  );

  const expectedMachineFiles = [
    ".openspec-store/store.yaml",
    "openspec/config.yaml",
    "openspec/context/system-map.yaml",
    "openspec-orch.yaml",
    ".gitignore",
  ];
  for (const relativePath of expectedMachineFiles) {
    assert.equal((await fs.stat(path.join(target, relativePath))).isFile(), true, relativePath);
  }
  const openSpecConfig = parse(
    await fs.readFile(path.join(target, "openspec", "config.yaml"), "utf8"),
  );
  assert.equal(openSpecConfig.schema, "spec-driven");
  assert.match(openSpecConfig.rules.proposal.join("\n"), /Jira Story/);
  assert.match(openSpecConfig.rules.proposal.join("\n"), /Repository impact/);
  assert.match(openSpecConfig.rules.specs.join("\n"), /SC-<CAPABILITY>-NNN/);
  const config = parseOrchestratorConfig(await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"));
  assert.deepEqual(config.storeRepository, {
    id: "payments-specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
  });
  assert.deepEqual(config.codeRepositories.map(({ id }) => id), ["ui"]);
  assert.equal((await fs.stat(path.join(target, result.agent.commandsDirectory))).isDirectory(), true);
  assert.equal(
    (await fs.stat(path.join(target, result.agent.targetDirectory, "agents"))).isDirectory(),
    true,
  );
  assert.equal((await fs.stat(path.join(target, result.agent.instructionsFile))).isFile(), true);
});

test("initProject persists relaxed mode only when it is explicitly requested", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
    noStrict: true,
    commandRunner: openSpec.runner,
  });
  const config = parseOrchestratorConfig(
    await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"),
  );
  assert.equal(result.executionMode, "relaxed");
  assert.equal(config.strict, false);
});

test("initProject removes generated agent artifacts when Store setup fails before metadata", async (t) => {
  assert.ok(RELOCATED_AGENT, "base Template должен проверять перенос generated pack");
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  let failSetup = true;
  const runner = async (command, args, options = {}) => {
    if (command === "openspec" && args[0] === "store" && args[1] === "setup" && failSetup) {
      failSetup = false;
      throw new Error("store_registry_busy");
    }
    const output = await openSpec.runner(command, args, options);
    if (command === "openspec" && args[0] === "init" && failSetup) {
      await fs.mkdir(path.join(target, "openspec"), { recursive: true });
      await fs.writeFile(path.join(target, "openspec", "config.yaml"), "schema: spec-driven\n");
    }
    return output;
  };

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: RELOCATED_AGENT.id,
      commandRunner: runner,
    }),
    /store_registry_busy/,
  );
  assert.equal(fsSync.existsSync(path.join(target, RELOCATED_AGENT.generatedDirectory)), false);
  assert.equal(fsSync.existsSync(path.join(target, RELOCATED_AGENT.targetDirectory)), false);
  assert.equal(fsSync.existsSync(path.join(target, "openspec", "config.yaml")), false);

  const retry = await initProject({
    target,
    storeId: "payments-specs",
    agentId: RELOCATED_AGENT.id,
    commandRunner: runner,
  });
  assert.equal(retry.alreadyInitialized, false);
  assert.equal(
    (await fs.stat(path.join(target, RELOCATED_AGENT.targetDirectory, "agents"))).isDirectory(),
    true,
  );
});

test("initProject preserves the complete public file tree for every supported agent", async (t) => {
  for (const agentId of BASE_AGENT_IDS) {
    const target = await temporaryProject(t);
    const openSpec = fakeOpenSpec(target);
    const result = await initProject({
      target,
      storeId: `${agentId}-specs`,
      agentId,
      commandRunner: openSpec.runner,
    });

    const selected = BASE_TEMPLATE_DESCRIPTOR.agents[agentId];
    assert.deepEqual(result.agent, { ...selected, copy: result.agent.copy });
    const commandFiles = OPEN_SPEC_COMMANDS.map(
      (name) => `${selected.commandsDirectory}/${name}`,
    );
    const projectCommandFiles = PROJECT_COMMANDS.map(
      (name) => `${selected.commandsDirectory}/${name}`,
    );
    const expected = [
      ...COMMON_INIT_FILES,
      ...commandFiles,
      ...projectCommandFiles,
      ...PROJECT_SKILLS.map((name) => `${selected.targetDirectory}/skills/${name}`),
      ...PROJECT_SUBAGENTS.map((name) => `${selected.targetDirectory}/agents/${name}`),
      selected.instructionsFile,
    ].sort();
    assert.deepEqual(await listProjectFiles(target), expected, agentId);
    assert.ok(
      openSpec.calls.some(
        (args) =>
          args[0] === "init" &&
          args[args.indexOf("--tools") + 1] === selected.openSpecId,
      ),
      agentId,
    );
    if (selected.generatedDirectory !== selected.targetDirectory) {
      assert.equal(fsSync.existsSync(path.join(target, selected.generatedDirectory)), false);
    }
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
      agentId: DEFAULT_AGENT_ID,
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
      agentId: DEFAULT_AGENT_ID,
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(
    openSpec.calls.some((args) => args[0] === "store" && args[1] === "setup"),
    false,
  );
  assert.equal(fsSync.existsSync(path.join(target, ".openspec-store")), false);
  assert.equal(fsSync.existsSync(path.join(target, DEFAULT_AGENT.targetDirectory)), false);
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
      agentId: DEFAULT_AGENT_ID,
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
    initProject({ target, storeId: "payments-specs", agentId: DEFAULT_AGENT_ID }),
  );
});

test("OpenSpec compatibility accepts semantic versions and reports missing capabilities", async () => {
  for (const version of ["1.7.0", "1.7.1", "1.8.0", "2.0.0-beta.1"]) {
    assert.equal(await inspectOpenSpecCli(() => version, "/tmp"), version);
  }
  await assert.rejects(inspectOpenSpecCli(() => "OpenSpec dev", "/tmp"), /semantic version/);
  assert.throws(
    () => requireOpenSpecCapability(false, "openspec store list --json: stores[]"),
    /OpenSpec Orchestrator требует JSON capability.*stores\[\]/,
  );
});

test("initProject does not modify a complete initialized Store", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
    commandRunner: openSpec.runner,
  });
  const callsBeforeRepeat = openSpec.calls.length;

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
  assert.deepEqual(result.created, []);
  assert.equal(openSpec.calls.length, callsBeforeRepeat);
});

test("initProject does not require an optional handoff file on successful repeat", async (t) => {
  const target = await temporaryProject(t);
  const templateRoot = await customTemplate(t);
  const openSpec = fakeOpenSpec(target);
  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "team-agent",
    templateRoot,
    commandRunner: openSpec.runner,
  });
  const callsBeforeRepeat = openSpec.calls.length;
  const missingInstructions = path.join(target, ".team-agent", "actions", "team-apply.md");
  await fs.unlink(missingInstructions);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "team-agent",
    templateRoot,
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
  assert.equal(openSpec.calls.length, callsBeforeRepeat);
  await assert.rejects(fs.stat(missingInstructions));
});

test("initProject blocks a conflicting Core config instead of overwriting it", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "openspec-orch.yaml"), "user owned\n", "utf8");
  await runCommand("git", ["-C", target, "config", "user.email", "tests@example.test"]);
  await runCommand("git", ["-C", target, "config", "user.name", "OpenSpec Orchestrator Tests"]);
  await runCommand("git", ["-C", target, "add", "openspec-orch.yaml"]);
  await runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: DEFAULT_AGENT_ID,
      commandRunner: openSpec.runner,
    }),
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(await fs.readFile(path.join(target, "openspec-orch.yaml"), "utf8"), "user owned\n");
});

test("initProject rejects differing pre-existing Template files without merging them", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, ".gitignore"), "node_modules/\n.openspec-orch/cache/\n", "utf8");
  await fs.mkdir(path.dirname(path.join(target, DEFAULT_AGENT.instructionsFile)), { recursive: true });
  await fs.writeFile(
    path.join(target, DEFAULT_AGENT.instructionsFile),
    "# Existing instructions\n",
    "utf8",
  );
  await configureRepository(target);
  await runCommand("git", ["-C", target, "add", ".gitignore", DEFAULT_AGENT.instructionsFile]);
  await runCommand("git", ["-C", target, "commit", "-m", "existing project files"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: DEFAULT_AGENT_ID,
      commandRunner: openSpec.runner,
    }),
    /существующий файл с другим содержимым/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(
    await fs.readFile(path.join(target, DEFAULT_AGENT.instructionsFile), "utf8"),
    "# Existing instructions\n",
  );
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

  assert.deepEqual(result.agent.id, "team-agent");
  assert.deepEqual(result.agent.openSpecId, "qwen");
  assert.deepEqual(result.agent.architecture, "markdown-commands");
  assert.deepEqual(result.agent.commandsDirectory, ".team-agent/actions");
  assert.deepEqual(result.agent.instructionsFile, "TEAM.md");
  assert.deepEqual(result.agent.handoffs, { apply: ".team-agent/actions/team-apply.md" });

  const repeat = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "team-agent",
    templateRoot,
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
      agentId: DEFAULT_AGENT_ID,
      templateRoot,
      commandRunner: openSpec.runner,
    }),
    new RegExp(`Template не поддерживает agent '${DEFAULT_AGENT_ID}'`),
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
  await configureRepository(target);
  await runCommand("git", ["-C", target, "add", ".gitignore"]);
  await runCommand("git", ["-C", target, "commit", "-m", "existing identical template file"]);
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
    commandRunner: openSpec.runner,
  });

  assert.equal(result.created.includes(".gitignore"), false);
  assert.equal(result.updated.includes(".gitignore"), false);
  assert.equal(await fs.readFile(path.join(target, ".gitignore"), "utf8"), gitIgnore);
});

test("initProject adopts a non-empty central repository through the official OpenSpec root", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "existing.txt"), "existing project\n", "utf8");
  await configureRepository(target);
  await runCommand("git", ["-C", target, "add", "existing.txt"]);
  await runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await initProject({
    target,
    storeId: "payments-specs",
    agentId: DEFAULT_AGENT_ID,
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
 * @returns {Promise<void>}
 */
async function configureRepository(repository) {
  await runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  await runCommand("git", ["-C", repository, "config", "user.name", "OpenSpec Orchestrator Tests"]);
}
