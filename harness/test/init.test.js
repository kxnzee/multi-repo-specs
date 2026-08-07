/** @fileoverview Интеграционные сценарии однократной инициализации Store. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveAgentAdapter } from "../config/agents.js";
import { assertSupportedOpenSpecVersion, parseSddConfig } from "../config/index.js";
import { initProject, parseRepository } from "../init/index.js";
import { runCommand } from "../shared/command.js";

/**
 * Создаёт тестовый центральный Git-репозиторий с origin.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь временного проекта.
 */
async function temporaryProject(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-init-"));
  const canonicalDirectory = await fs.realpath(directory);
  t.after(async () => fs.rm(canonicalDirectory, { recursive: true, force: true }));
  runCommand("git", ["init", "--initial-branch", "main", canonicalDirectory]);
  runCommand("git", ["-C", canonicalDirectory, "remote", "add", "origin", "https://example.test/specs.git"]);
  return canonicalDirectory;
}

/**
 * Имитирует OpenSpec init и Store API для тестов `sdd init`.
 *
 * @param {string} projectRoot Корень тестового проекта.
 * @returns {{calls: string[][], runner: typeof runCommand}} Тестовый runner и журнал аргументов.
 */
function fakeOpenSpec(projectRoot) {
  const calls = [];
  let storeId;
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
      const agent = resolveAgentAdapter(args[args.indexOf("--tools") + 1]);
      fsSync.mkdirSync(path.join(projectRoot, agent.commandsDirectory), { recursive: true });
      fsSync.writeFileSync(
        path.join(projectRoot, agent.commandsDirectory, "opsx-explore.md"),
        "original OpenSpec action\n",
      );
      if (agent.id === "qwen") {
        fsSync.mkdirSync(path.join(projectRoot, ".qwen", "skills", "openspec-explore"), {
          recursive: true,
        });
        fsSync.writeFileSync(
          path.join(projectRoot, ".qwen", "skills", "openspec-explore", "SKILL.md"),
          "original OpenSpec skill\n",
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
  assert.throws(() => parseRepository("UI=https://example.test/ui.git#main"), /Ожидается <id=url#branch>/);
  assert.throws(() => parseRepository("ui=https://example.test/ui.git"), /Ожидается <id=url#branch>/);
});

test("initProject creates Store, official core pack and the complete skeleton", async (t) => {
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
      (args) => args[0] === "init" && args.includes("qwen") && args.includes("core"),
    ),
  );

  const expectedFiles = [
    ".openspec-store/store.yaml",
    ".qwen/commands/opsx-explore.md",
    ".qwen/commands/sdd-context.md",
    ".qwen/skills/openspec-explore/SKILL.md",
    "openspec/config.yaml",
    "openspec/context/00-start-here.md",
    "openspec/context/08-release-process.md",
    "openspec/context/system-map.yaml",
    "openspec/context/ADR/README.md",
    "openspec/context/_raw/README.md",
    "QWEN.md",
    "sdd.yaml",
    "CODEOWNERS",
    ".gitignore",
  ];
  for (const relativePath of expectedFiles) {
    assert.equal((await fs.stat(path.join(target, relativePath))).isFile(), true, relativePath);
  }

  assert.equal(
    await fs.readFile(path.join(target, ".qwen", "commands", "opsx-explore.md"), "utf8"),
    "original OpenSpec action\n",
  );
  const config = parseSddConfig(await fs.readFile(path.join(target, "sdd.yaml"), "utf8"));
  assert.deepEqual(config.storeRepository, {
    id: "payments-specs",
    role: "store",
    url: "https://example.test/specs.git",
    defaultBranch: "main",
  });
  assert.deepEqual(config.codeRepositories.map(({ id }) => id), ["ui"]);

  const openSpecConfig = await fs.readFile(path.join(target, "openspec/config.yaml"), "utf8");
  assert.match(openSpecConfig, /^schema: spec-driven/m);
  assert.match(openSpecConfig, /^rules:$/m);
  await assert.rejects(fs.stat(path.join(target, "openspec/schemas")), /ENOENT/);
  const contextCommand = await fs.readFile(
    path.join(target, ".qwen/commands/sdd-context.md"),
    "utf8",
  );
  assert.match(contextCommand, /\.openspec-store\/store\.yaml/);
  assert.match(contextCommand, /явно передавай `--store <store-id>`/);
  assert.match(contextCommand, /первым и единственным вопросом сообщения спроси/);
  assert.match(contextCommand, /задавай ровно один вопрос/);
  assert.match(contextCommand, /Содержательные вопросы задавай открытым текстом/);
  assert.match(contextCommand, /Не придумывай за пользователя/);
  assert.match(contextCommand, /не читались и не изменялись Code Repositories/);
  assert.match(contextCommand, /Статус описывает только соответствие центрального context pack/);
  assert.doesNotMatch(contextCommand, /получи временную Git-копию/);
  assert.doesNotMatch(contextCommand, /Сверь контекст со свежим состоянием систем/);
});

test("initProject persists GigaCode through the Qwen OpenSpec adapter", async (t) => {
  const target = await temporaryProject(t);
  await fs.mkdir(path.join(target, ".qwen", "commands"), { recursive: true });
  await fs.writeFile(
    path.join(target, ".qwen", "commands", "opsx-existing.md"),
    "existing official action\n",
    "utf8",
  );
  configureRepository(target);
  runCommand("git", ["-C", target, "add", ".qwen"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing OpenSpec pack"]);
  const openSpec = fakeOpenSpec(target);

  await initProject({
    target,
    storeId: "payments-specs",
    agentId: "gigacode",
    commandRunner: openSpec.runner,
  });

  const config = parseSddConfig(await fs.readFile(path.join(target, "sdd.yaml"), "utf8"));
  assert.deepEqual(config.agent, resolveAgentAdapter("gigacode"));
  assert.equal(
    (await fs.stat(path.join(target, ".gigacode", "commands", "sdd-context.md"))).isFile(),
    true,
  );
  const gigaContextCommand = await fs.readFile(
    path.join(target, ".gigacode", "commands", "sdd-context.md"),
    "utf8",
  );
  assert.match(gigaContextCommand, /Работай только внутри текущего центрального репозитория/);
  assert.match(gigaContextCommand, /не читались и не изменялись Code Repositories/);
  assert.doesNotMatch(gigaContextCommand, /получи временную Git-копию/);
  assert.equal(
    (
      await fs.stat(
        path.join(target, ".gigacode", "skills", "openspec-explore", "SKILL.md"),
      )
    ).isFile(),
    true,
  );
  assert.equal(
    await fs.readFile(
      path.join(target, ".gigacode", "commands", "opsx-existing.md"),
      "utf8",
    ),
    "existing official action\n",
  );
  assert.equal((await fs.stat(path.join(target, "GIGACODE.md"))).isFile(), true);
  assert.equal(fsSync.existsSync(path.join(target, ".qwen")), false);
  assert.equal(fsSync.existsSync(path.join(target, "QWEN.md")), false);
  assert.ok(
    openSpec.calls.some(
      (args) => args[0] === "init" && args[args.indexOf("--tools") + 1] === "qwen",
    ),
  );
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
    /чистое рабочее дерево/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(fsSync.existsSync(path.join(target, ".openspec-store")), false);
});

test("initProject treats existing Store metadata as completed initialization", async (t) => {
  const target = await temporaryProject(t);
  await fs.mkdir(path.join(target, ".openspec-store"));
  await fs.writeFile(
    path.join(target, ".openspec-store", "store.yaml"),
    'version: 1\nid: payments-specs\nremote: "https://example.test/specs.git"\n',
  );
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    agentId: "qwen",
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
  assert.deepEqual(result.created, []);
  assert.deepEqual(openSpec.calls, []);
  await assert.rejects(fs.stat(path.join(target, "sdd.yaml")), /ENOENT/);
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
    /инициализирован с ID another-store/,
  );
});

test("SDD accepts only OpenSpec 1.7.0", () => {
  assert.equal(assertSupportedOpenSpecVersion("1.7.0"), "1.7.0");
  assert.throws(() => assertSupportedOpenSpecVersion("1.7.1"), /требует OpenSpec 1\.7\.0/);
  assert.throws(() => assertSupportedOpenSpecVersion("1.8.0"), /требует OpenSpec 1\.7\.0/);
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

test("initProject blocks conflicting skeleton paths instead of overwriting them", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "sdd.yaml"), "user owned\n", "utf8");
  runCommand("git", ["-C", target, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", target, "config", "user.name", "SDD Tests"]);
  runCommand("git", ["-C", target, "add", "sdd.yaml"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      agentId: "qwen",
      commandRunner: openSpec.runner,
    }),
    /существующие SDD\/OpenSpec-пути: sdd.yaml/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(await fs.readFile(path.join(target, "sdd.yaml"), "utf8"), "user owned\n");
});

test("initProject preserves and extends existing gitignore and CODEOWNERS", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, ".gitignore"), "node_modules/\n.sdd/cache/\n", "utf8");
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
  assert.match(gitIgnore, /^node_modules\/\n/m);
  assert.equal(gitIgnore.match(/^\.sdd\/cache\/$/gm)?.length, 1);
  assert.match(gitIgnore, /^\.sdd\/logs\/$/m);
  assert.match(gitIgnore, /^\.sdd\/credentials\/$/m);
  assert.doesNotMatch(gitIgnore, /^\.sdd\/checkouts\/$/m);

  const codeOwners = await fs.readFile(path.join(target, "CODEOWNERS"), "utf8");
  assert.match(codeOwners, /^\* @existing-team$/m);
  assert.match(codeOwners, /# \/openspec\/specs\/\*\* @spec-owner/);
  assert.deepEqual(result.updated.sort(), [".gitignore", "CODEOWNERS", "openspec/config.yaml"]);
  assert.equal(result.created.includes(".gitignore"), false);
  assert.equal(result.created.includes("CODEOWNERS"), false);
});

test("initProject adopts a non-empty central repository through the official OpenSpec root", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "README.md"), "existing project\n", "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", "README.md"]);
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
  assert.equal(await fs.readFile(path.join(target, "README.md"), "utf8"), "existing project\n");
});

/**
 * Настраивает локальную Git identity для тестовых коммитов.
 *
 * @param {string} repository Путь тестового Git-репозитория.
 * @returns {void}
 */
function configureRepository(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "SDD Tests"]);
}
