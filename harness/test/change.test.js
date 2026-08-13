/** @fileoverview Интеграционные сценарии создания и продолжения OpenSpec Change. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildChangeId, prepareChange } from "../change/index.js";
import { resolveAgentAdapter } from "../config/agents.js";
import { serializeSddConfig } from "../config/index.js";
import { runCommand } from "../shared/command.js";

const QWEN = resolveAgentAdapter("qwen");
const SDD_TEMPLATE =
  'version: 1\nversions:\n  process: draft\n  openspec: "1.7.0"\nagent: null\nrepositories: []\n';

/**
 * Настраивает локальную Git identity.
 *
 * @param {string} repository Git checkout.
 * @returns {void}
 */
function configureGit(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "SDD Tests"]);
}

/**
 * Создаёт Store checkout с bare remote и автоматически удаляет сценарий.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @param {{archived?: string[]}} [options] Архивные Changes.
 * @returns {Promise<{root: string, storeRoot: string, remote: string}>} Пути сценария.
 */
async function createScenario(t, { archived = [] } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-change-")));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const storeRoot = path.join(root, "payments-specs");
  const remote = path.join(root, "payments-specs.git");
  await fs.mkdir(storeRoot);
  runCommand("git", ["init", "--initial-branch", "main", storeRoot]);
  configureGit(storeRoot);

  const repositories = [{
    id: "payments-specs",
    role: "store",
    url: remote,
    defaultBranch: "main",
  }];
  const files = {
    ".openspec-store/store.yaml":
      `version: 1\nid: payments-specs\nremote: ${JSON.stringify(remote)}\n`,
    "sdd.yaml": serializeSddConfig(SDD_TEMPLATE, repositories, QWEN),
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/context/00-start-here.md": "# Start\n",
    "openspec/context/system-map.yaml": "systems: []\nrelationships: []\n",
    "openspec/changes/archive/.gitkeep": "",
  };
  for (const name of archived) files[`openspec/changes/archive/${name}/.gitkeep`] = "";
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(storeRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  runCommand("git", ["-C", storeRoot, "add", "."]);
  runCommand("git", ["-C", storeRoot, "commit", "-m", "initial"]);
  runCommand("git", ["clone", "--bare", storeRoot, remote]);
  runCommand("git", ["-C", storeRoot, "remote", "add", "origin", remote]);
  return { root, storeRoot: await fs.realpath(storeRoot), remote };
}

/**
 * Имитирует машинные ответы OpenSpec и создаёт каркас через официальный вызов runner.
 *
 * @param {string} storeRoot Корень Store.
 * @param {string[]} [initialChanges] Исходные активные Changes.
 * @returns {{calls: string[][], runner: typeof runCommand}} Runner и журнал OpenSpec.
 */
function fakeOpenSpec(storeRoot, initialChanges = []) {
  const calls = [];
  const changes = [...initialChanges];
  const root = { path: storeRoot, source: "store", store_id: "payments-specs" };
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push(args);
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
          metadata: { present: true, valid: true, id: "payments-specs" },
          openspec_root: { present: true, healthy: true, status: [] },
          status: [],
        }],
        status: [],
      });
    }
    if (args[0] === "doctor") {
      return JSON.stringify({
        root: { ...root, healthy: true },
        store: { id: "payments-specs", status: [] },
        references: [],
        status: [],
      });
    }
    if (args[0] === "context") {
      return JSON.stringify({ root, members: [], status: [] });
    }
    if (args[0] === "list" && args.includes("--specs")) {
      return JSON.stringify({ specs: [], root, status: [] });
    }
    if (args[0] === "list" && args.includes("--changes")) {
      return JSON.stringify({ changes: changes.map((name) => ({ name })), root, status: [] });
    }
    if (args[0] === "new" && args[1] === "change") {
      const changeId = args[2];
      const changeRoot = path.join(storeRoot, "openspec", "changes", changeId);
      fsSync.mkdirSync(changeRoot, { recursive: true });
      fsSync.writeFileSync(path.join(changeRoot, ".openspec.yaml"), "schema: spec-driven\n");
      changes.push(changeId);
      return JSON.stringify({
        change: {
          id: changeId,
          path: changeRoot,
          metadataPath: path.join(changeRoot, ".openspec.yaml"),
          schema: "spec-driven",
        },
        root,
        status: [],
      });
    }
    if (args[0] === "status") {
      const changeId = args[args.indexOf("--change") + 1];
      const changeRoot = path.join(storeRoot, "openspec", "changes", changeId);
      const proposalExists = fsSync.existsSync(path.join(changeRoot, "proposal.md"));
      return JSON.stringify({
        changeName: changeId,
        schemaName: "spec-driven",
        changeRoot,
        isComplete: false,
        artifacts: [
          { id: "proposal", outputPath: "proposal.md", status: proposalExists ? "done" : "ready", requires: [] },
          { id: "specs", outputPath: "specs/**/*.md", status: proposalExists ? "ready" : "blocked", requires: ["proposal"] },
          { id: "design", outputPath: "design.md", status: proposalExists ? "ready" : "blocked", requires: ["proposal"] },
          { id: "tasks", outputPath: "tasks.md", status: "blocked", requires: ["specs", "design"] },
        ],
        root,
        status: [],
      });
    }
    throw new Error(`Unexpected OpenSpec call: ${joined}`);
  };
  return { calls, runner };
}

test("buildChangeId keeps an alphanumeric ticket compatible with OpenSpec naming", () => {
  assert.equal(buildChangeId("TEST1-TEST0", "pilot"), "test1-test0-pilot");
  assert.throws(() => buildChangeId("TEST--1", "pilot"));
});

test("prepareChange creates a planning branch and standard OpenSpec Change", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const result = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-412",
    name: "payment-status",
    storeId: "payments-specs",
    commandRunner: openSpec.runner,
  });

  assert.equal(result.changeStatus, "created");
  assert.equal(result.changeId, "pay-412-payment-status");
  assert.equal(result.branch, "feature/pay-412-payment-status");
  assert.equal(result.proposalStatus, "missing");
  assert.equal(result.nextAction, "create_proposal");
  assert.equal(
    runCommand("git", ["branch", "--show-current"], { cwd: scenario.storeRoot }),
    result.branch,
  );
  assert.equal(
    (await fs.stat(path.join(result.changePath, ".openspec.yaml"))).isFile(),
    true,
  );
  assert.ok(openSpec.calls.some((args) => args.join(" ") === [
    "new",
    "change",
    "pay-412-payment-status",
    "--schema",
    "spec-driven",
    "--store",
    "payments-specs",
    "--json",
  ].join(" ")));
  assert.ok(openSpec.calls.some((args) => args.join(" ") === [
    "status",
    "--change",
    "pay-412-payment-status",
    "--store",
    "payments-specs",
    "--json",
  ].join(" ")));
});

test("prepareChange rejects an explicit Store ID from another checkout", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-412",
      name: "payment-status",
      storeId: "other-specs",
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.storeRoot }), "main");
});

test("prepareChange safely resumes an existing Proposal without recreating Change", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const created = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-413",
    name: "session-timeout",
    commandRunner: openSpec.runner,
  });
  await fs.writeFile(path.join(created.changePath, "proposal.md"), "# Proposal\n", "utf8");

  const resumed = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-413",
    name: "session-timeout",
    commandRunner: openSpec.runner,
  });
  assert.equal(resumed.changeStatus, "existing");
  assert.equal(resumed.proposalStatus, "present");
  assert.equal(resumed.nextAction, "review_proposal");
  assert.equal(openSpec.calls.filter((args) => args[0] === "new").length, 1);
});

test("prepareChange blocks another active Change for the same ticket", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot, ["pay-414-other"]);
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-414",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.storeRoot }), "main");
});

test("prepareChange requires explicit confirmation for an archived ticket", async (t) => {
  const scenario = await createScenario(t, { archived: ["2026-08-01-pay-415-old"] });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-415",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-415",
      name: "payment-status",
      confirmArchivedChange: async () => false,
      commandRunner: openSpec.runner,
    }),
  );
  const result = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-415",
    name: "payment-status",
    confirmArchivedChange: async (changes) => changes.includes("2026-08-01-pay-415-old"),
    commandRunner: openSpec.runner,
  });
  assert.equal(result.changeStatus, "created");
});

test("prepareChange reports recovery for a planning branch without Change", async (t) => {
  const scenario = await createScenario(t);
  runCommand("git", ["switch", "-c", "feature/pay-416-payment-status"], {
    cwd: scenario.storeRoot,
  });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-416",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareChange blocks changes outside the current Change and later artifacts", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const created = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-417",
    name: "payment-status",
    commandRunner: openSpec.runner,
  });
  await fs.writeFile(path.join(scenario.storeRoot, "unexpected.txt"), "dirty\n", "utf8");
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-417",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
  await fs.rm(path.join(scenario.storeRoot, "unexpected.txt"));
  await fs.writeFile(path.join(created.changePath, "design.md"), "# Design\n", "utf8");
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-417",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareChange blocks an existing remote planning branch", async (t) => {
  const scenario = await createScenario(t);
  runCommand(
    "git",
    ["push", "origin", "main:refs/heads/feature/pay-418-payment-status"],
    { cwd: scenario.storeRoot },
  );
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-418",
      name: "payment-status",
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.storeRoot }), "main");
});
