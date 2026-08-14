/** @fileoverview Интеграционные сценарии создания и продолжения OpenSpec Change. */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildChangeId, prepareChange } from "../src/internal/change/index.js";
import { serializeOrchestratorConfig } from "../src/internal/config/index.js";
import { runCommand } from "../src/internal/shared/command.js";
import { agentFixture } from "../test-fixtures/agents.js";
import {
  commitFiles,
  initializeGitRepository,
  temporaryDirectory,
} from "../test-fixtures/workspace.js";

const QWEN = agentFixture("qwen");
const ORCHESTRATOR_TEMPLATE =
  'version: 1\nversions:\n  process: draft\n  openspec: "1.7.0"\nagent: null\nrepositories: []\n';

/**
 * Создаёт Store checkout с bare remote и автоматически удаляет сценарий.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @param {{archived?: string[], schema?: string}} [options] Архивные Changes и schema проекта.
 * @returns {Promise<{root: string, storeRoot: string, remote: string}>} Пути сценария.
 */
async function createScenario(t, { archived = [], schema = "spec-driven" } = {}) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-change-");
  const storeRoot = path.join(root, "payments-specs");
  const remote = path.join(root, "payments-specs.git");
  await fs.mkdir(storeRoot);
  initializeGitRepository(storeRoot);

  const repositories = [{
    id: "payments-specs",
    role: "store",
    url: remote,
    defaultBranch: "main",
  }];
  const files = {
    ".openspec-store/store.yaml":
      `version: 1\nid: payments-specs\nremote: ${JSON.stringify(remote)}\n`,
    "openspec-orch.yaml": serializeOrchestratorConfig(ORCHESTRATOR_TEMPLATE, repositories, QWEN),
    "openspec/config.yaml": `schema: ${schema}\n`,
    "openspec/context/00-start-here.md": "# Start\n",
    "openspec/context/system-map.yaml": "systems: []\nrelationships: []\n",
    "openspec/changes/archive/.gitkeep": "",
  };
  for (const name of archived) files[`openspec/changes/archive/${name}/.gitkeep`] = "";
  await commitFiles(storeRoot, files);
  runCommand("git", ["clone", "--bare", storeRoot, remote]);
  runCommand("git", ["-C", storeRoot, "remote", "add", "origin", remote]);
  return { root, storeRoot: await fs.realpath(storeRoot), remote };
}

/**
 * Имитирует машинные ответы OpenSpec и создаёт каркас через официальный вызов runner.
 *
 * @param {string} storeRoot Корень Store.
 * @param {string[]} [initialChanges] Исходные активные Changes.
 * @param {{schema?: string}} [options] Динамическая OpenSpec schema.
 * @returns {{calls: string[][], runner: typeof runCommand}} Runner и журнал OpenSpec.
 */
function fakeOpenSpec(storeRoot, initialChanges = [], { schema = "spec-driven" } = {}) {
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
      fsSync.writeFileSync(path.join(changeRoot, ".openspec.yaml"), `schema: ${schema}\n`);
      changes.push(changeId);
      return JSON.stringify({
        change: {
          id: changeId,
          path: changeRoot,
          metadataPath: path.join(changeRoot, ".openspec.yaml"),
          schema,
        },
        root,
        status: [],
      });
    }
    if (args[0] === "status") {
      const changeId = args[args.indexOf("--change") + 1];
      const changeRoot = path.join(storeRoot, "openspec", "changes", changeId);
      const proposalExists = fsSync.existsSync(path.join(changeRoot, "proposal.md"));
      const briefPath = path.join(changeRoot, "briefs", "change.md");
      const artifacts = schema === "research-only"
        ? [{
            id: "brief",
            outputPath: "briefs/change.md",
            status: fsSync.existsSync(briefPath) ? "done" : "ready",
            requires: [],
          }]
        : [
            { id: "proposal", outputPath: "proposal.md", status: proposalExists ? "done" : "ready", requires: [] },
            { id: "specs", outputPath: "specs/**/*.md", status: proposalExists ? "ready" : "blocked", requires: ["proposal"] },
            { id: "design", outputPath: "design.md", status: proposalExists ? "ready" : "blocked", requires: ["proposal"] },
            { id: "tasks", outputPath: "tasks.md", status: "blocked", requires: ["specs", "design"] },
          ];
      const artifactPaths = Object.fromEntries(artifacts.map((artifact) => {
        const resolvedOutputPath = path.join(changeRoot, artifact.outputPath);
        return [artifact.id, {
          outputPath: artifact.outputPath,
          resolvedOutputPath,
          existingOutputPaths: fsSync.existsSync(resolvedOutputPath) ? [resolvedOutputPath] : [],
        }];
      }));
      return JSON.stringify({
        changeName: changeId,
        schemaName: schema,
        changeRoot,
        isComplete: false,
        applyRequires: schema === "research-only" ? ["brief"] : ["tasks"],
        artifactPaths,
        artifacts,
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
  assert.equal(result.schema, "spec-driven");
  assert.equal(result.nextArtifact.id, "proposal");
  assert.equal(result.nextArtifact.resolvedOutputPath, path.join(result.changePath, "proposal.md"));
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

test("prepareChange relaxed mode creates a Change without managing Git branches", async (t) => {
  const scenario = await createScenario(t);
  await fs.writeFile(path.join(scenario.storeRoot, "local.txt"), "intentional local state\n", "utf8");
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  const result = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-420",
    name: "local-flow",
    noStrict: true,
    commandRunner: openSpec.runner,
  });

  assert.equal(result.executionMode, "relaxed");
  assert.equal(result.branch, null);
  assert.equal(result.baseRevision, "unpinned");
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.storeRoot }), "main");
});

test("prepareChange reports a concrete missing OpenSpec JSON capability", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    if (command === "openspec" && args.join(" ") === "store list --json") {
      return JSON.stringify({ status: [] });
    }
    return openSpec.runner(command, args, options);
  };

  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-421",
      name: "missing-capability",
      commandRunner: runner,
    }),
    /OpenSpec Orchestrator требует JSON capability: openspec store list --json: stores\[\]/,
  );
});

test("prepareChange attributes an unsupported status contract to the Orchestrator", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    const output = openSpec.runner(command, args, options);
    if (command !== "openspec" || args[0] !== "status") return output;
    const status = JSON.parse(output);
    delete status.schemaName;
    return JSON.stringify(status);
  };

  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-422",
      name: "unsupported-status",
      commandRunner: runner,
    }),
    /OpenSpec Orchestrator не может обработать ответ `openspec status --json`: несовместимый формат/,
  );
});

test("prepareChange reports a status identity mismatch separately", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const runner = (command, args, options) => {
    const output = openSpec.runner(command, args, options);
    if (command !== "openspec" || args[0] !== "status") return output;
    const status = JSON.parse(output);
    status.changeName = "another-change";
    return JSON.stringify(status);
  };

  await assert.rejects(
    prepareChange({
      start: scenario.storeRoot,
      ticket: "PAY-423",
      name: "wrong-status-identity",
      commandRunner: runner,
    }),
    /Ответ `openspec status --json` относится к Change another-change, ожидался pay-423-wrong-status-identity/,
  );
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

test("prepareChange safely resumes an existing Change without recreating it", async (t) => {
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
  assert.equal(resumed.nextArtifact.id, "specs");
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

test("prepareChange blocks changes outside the current Change but accepts schema artifacts", async (t) => {
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
  const continued = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-417",
    name: "payment-status",
    commandRunner: openSpec.runner,
  });
  assert.equal(continued.changeStatus, "existing");
});

test("prepareChange follows a custom schema without proposal or tasks", async (t) => {
  const scenario = await createScenario(t, { schema: "research-only" });
  const openSpec = fakeOpenSpec(scenario.storeRoot, [], { schema: "research-only" });
  const result = await prepareChange({
    start: scenario.storeRoot,
    ticket: "PAY-419",
    name: "research",
    commandRunner: openSpec.runner,
  });

  assert.equal(result.schema, "research-only");
  assert.equal(result.nextArtifact.id, "brief");
  assert.equal(result.nextArtifact.outputPath, "briefs/change.md");
  assert.equal(openSpec.calls.some((args) => args.includes("--schema")), false);
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
