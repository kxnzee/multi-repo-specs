/** @fileoverview Интеграционные сценарии `openspec-orch load` с настоящими Git worktree. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { serializeOrchestratorConfig } from "../config/index.js";
import { prepareLoad } from "../load/index.js";
import { runCommand } from "../shared/command.js";
import { agentFixture } from "../test-fixtures/agents.js";

const TEMPLATE =
  'version: 1\nversions:\n  process: draft\n  openspec: "1.7.0"\nagent: null\nrepositories: []\n';
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/openspec-orch.js");

/** @param {string} repository */
function configureGit(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "OpenSpec Orchestrator Tests"]);
}

/** @param {string} repository @param {Record<string, string>} files */
async function commitFiles(repository, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(repository, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  runCommand("git", ["-C", repository, "add", "."]);
  runCommand("git", ["-C", repository, "commit", "-m", "initial"]);
}

/**
 * @param {import("node:test").TestContext} t
 * @param {{storeInsideWorkspace?: boolean, agentId?: "qwen" | "gigacode", includeAgentInstructions?: boolean, includeApplyHandoff?: boolean}} [options]
 * @returns {Promise<{workspace: string, storeRoot: string, codeRoot: string, storeRemote: string, codeRemote: string, baseline: string}>}
 */
async function createScenario(t, {
  storeInsideWorkspace = true,
  agentId = "qwen",
  includeAgentInstructions = true,
  includeApplyHandoff = true,
} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-load-")));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const storeRoot = storeInsideWorkspace
    ? path.join(workspace, "openspec", "payments-specs")
    : path.join(root, "central-store", "payments-specs");
  const codeRoot = path.join(workspace, "src", "payments-api");
  const storeRemote = path.join(root, "payments-specs.git");
  const codeRemote = path.join(root, "payments-api.git");
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.mkdir(codeRoot, { recursive: true });
  runCommand("git", ["init", "--initial-branch", "main", storeRoot]);
  runCommand("git", ["init", "--initial-branch", "main", codeRoot]);
  configureGit(storeRoot);
  configureGit(codeRoot);

  const repositories = [
    { id: "payments-specs", role: "store", url: storeRemote, defaultBranch: "main" },
    { id: "payments-api", role: "code", url: codeRemote, defaultBranch: "main" },
  ];
  const baseAgent = agentFixture(agentId);
  const agent = includeApplyHandoff ? baseAgent : { ...baseAgent, handoffs: {} };
  const storeFiles = {
    ".openspec-store/store.yaml":
      `version: 1\nid: payments-specs\nremote: ${JSON.stringify(storeRemote)}\n`,
    "openspec-orch.yaml": serializeOrchestratorConfig(TEMPLATE, repositories, agent),
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/changes/pay-412-payment-status/proposal.md": "# Proposal\n",
    "openspec/changes/pay-412-payment-status/tasks.md": "- [ ] 2.1 API\n- [ ] 2.2 tests\n",
  };
  if (includeApplyHandoff) {
    storeFiles[agent.handoffs.apply] = "Apply from verified runtime.\n";
  }
  if (includeAgentInstructions) {
    storeFiles[agent.instructionsFile] = `# Instructions for ${agent.id}\n`;
  }
  await commitFiles(storeRoot, storeFiles);
  await commitFiles(codeRoot, {
    "README.md": "# API\n",
    "openspec/config.yaml": "store: payments-specs\n",
  });
  runCommand("git", ["clone", "--bare", storeRoot, storeRemote]);
  runCommand("git", ["clone", "--bare", codeRoot, codeRemote]);
  runCommand("git", ["-C", storeRoot, "remote", "add", "origin", storeRemote]);
  runCommand("git", ["-C", codeRoot, "remote", "add", "origin", codeRemote]);
  return {
    workspace,
    storeRoot: await fs.realpath(storeRoot),
    codeRoot: await fs.realpath(codeRoot),
    storeRemote,
    codeRemote,
    baseline: runCommand("git", ["-C", storeRoot, "rev-parse", "HEAD"]),
  };
}

/**
 * @param {string} storeRoot
 * @returns {{calls: Array<{args: string[], cwd: string}>, runner: typeof runCommand}}
 */
function fakeOpenSpec(storeRoot) {
  const calls = [];
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push({ args, cwd: options.cwd });
    if (args.join(" ") === "doctor --json") {
      return JSON.stringify({
        root: { path: storeRoot, source: "declared", store_id: "payments-specs", healthy: true },
        status: [],
      });
    }
    if (args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [{
          id: "payments-specs",
          root: storeRoot,
          metadata: { present: true, valid: true },
          openspec_root: { present: true, healthy: true },
          status: [],
        }],
        status: [],
      });
    }
    const root = { path: options.cwd, source: "nearest" };
    if (args[0] === "validate") {
      return JSON.stringify({
        items: [{ id: "pay-412-payment-status", type: "change", valid: true }],
        root,
        status: [],
      });
    }
    if (args[0] === "instructions" && args[1] === "apply") {
      return JSON.stringify({
        changeName: "pay-412-payment-status",
        state: "ready",
        tasks: [
          { id: "1", description: "2.1 API", done: false },
          { id: "2", description: "2.2 tests", done: false },
        ],
        root,
        status: [],
      });
    }
    throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
  };
  return { calls, runner };
}

test("prepareLoad requires provider instructions on the accepted Baseline", async (t) => {
  const scenario = await createScenario(t, { includeAgentInstructions: false });
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    prepareLoad({
      start: scenario.codeRoot,
      storeId: "payments-specs",
      repositoryId: "payments-api",
      changeId: "pay-412-payment-status",
      baseline: scenario.baseline,
      workPackages: ["1"],
      commandRunner: openSpec.runner,
    }),
  );
});

test("prepareLoad reports a lazy error when Template did not declare Apply handoff", async (t) => {
  const scenario = await createScenario(t, { includeApplyHandoff: false });
  const openSpec = fakeOpenSpec(scenario.storeRoot);

  await assert.rejects(
    prepareLoad({
      start: scenario.codeRoot,
      storeId: "payments-specs",
      repositoryId: "payments-api",
      changeId: "pay-412-payment-status",
      baseline: scenario.baseline,
      workPackages: ["1"],
      commandRunner: openSpec.runner,
    }),
    /не объявил agent\.handoffs\.apply/,
  );
});

test("prepareLoad creates an exact Store worktree, implementation branch and minimal runtime", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await fs.writeFile(path.join(scenario.storeRoot, "local-owner-notes.txt"), "dirty Store checkout is allowed\n", "utf8");
  await fs.writeFile(path.join(scenario.storeRoot, "openspec-orch.yaml"), "invalid local edit: [\n", "utf8");
  const result = await prepareLoad({
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1", "2"],
    commandRunner: openSpec.runner,
  });

  assert.equal(result.stepStatus, "implementation_ready");
  assert.equal(result.repositoryId, "payments-api");
  assert.equal(result.branchStatus, "created");
  assert.deepEqual(result.selectedTasks, [
    { id: "1", description: "2.1 API" },
    { id: "2", description: "2.2 tests" },
  ]);
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.codeRoot }), result.implementationBranch);
  const context = JSON.parse(await fs.readFile(result.runtimePath, "utf8"));
  assert.deepEqual(Object.keys(context).sort(), [
    "allowed_edit_roots", "change_id", "code_base_revision", "code_root", "immutable_roots",
    "implementation_branch", "repository_id", "spec_baseline", "spec_root", "step_status",
    "store_id", "version", "work_packages",
  ].sort());
  assert.deepEqual(context.allowed_edit_roots, [scenario.codeRoot]);
  assert.deepEqual(context.immutable_roots, [context.spec_root]);
  assert.equal(runCommand("git", ["rev-parse", "HEAD"], { cwd: context.spec_root }), scenario.baseline);
  assert.ok(openSpec.calls.some(({ args }) => args.join(" ") === [
    "validate", "pay-412-payment-status", "--type", "change", "--strict", "--no-interactive", "--json",
  ].join(" ")));
  assert.equal(openSpec.calls.some(({ args }) => args[0] === "status"), false);
});

test("prepareLoad verifies explicit Store and repository IDs from the subtask", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  };

  await assert.rejects(
    prepareLoad({ ...options, storeId: "wrong-store" }),
  );
  await assert.rejects(
    prepareLoad({ ...options, repositoryId: "wrong-api" }),
  );
});

test("prepareLoad is idempotent after implementation commits on the same Baseline", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1", "2"],
    commandRunner: openSpec.runner,
  };
  const first = await prepareLoad(options);
  const firstBase = JSON.parse(await fs.readFile(first.runtimePath, "utf8")).code_base_revision;
  await fs.writeFile(path.join(scenario.codeRoot, "implementation.txt"), "done\n", "utf8");
  runCommand("git", ["-C", scenario.codeRoot, "add", "implementation.txt"]);
  runCommand("git", ["-C", scenario.codeRoot, "commit", "-m", "implementation"]);
  const second = await prepareLoad({ ...options, workPackages: ["2", "1"] });
  assert.equal(second.branchStatus, "existing");
  const context = JSON.parse(await fs.readFile(second.runtimePath, "utf8"));
  const implementationHead = runCommand("git", ["-C", scenario.codeRoot, "rev-parse", "HEAD"]);
  assert.notEqual(implementationHead, context.code_base_revision);
  assert.equal(context.code_base_revision, firstBase);
});

test("prepareLoad rejects an unassigned or completed Work Package before creating a branch", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  await assert.rejects(
    prepareLoad({
      start: scenario.codeRoot,
      storeId: "payments-specs",
      repositoryId: "payments-api",
      changeId: "pay-412-payment-status",
      baseline: scenario.baseline,
      workPackages: ["9"],
      commandRunner: openSpec.runner,
    }),
  );
  assert.equal(runCommand("git", ["branch", "--show-current"], { cwd: scenario.codeRoot }), "main");
});

test("prepareLoad uses the current subtask Baseline after implementation commits", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  };
  const first = await prepareLoad(options);
  await fs.writeFile(path.join(scenario.codeRoot, "implementation.txt"), "started\n", "utf8");
  runCommand("git", ["-C", scenario.codeRoot, "add", "implementation.txt"]);
  runCommand("git", ["-C", scenario.codeRoot, "commit", "-m", "implementation"]);
  await fs.writeFile(path.join(scenario.storeRoot, "accepted-correction.md"), "# Correction\n", "utf8");
  runCommand("git", ["-C", scenario.storeRoot, "add", "accepted-correction.md"]);
  runCommand("git", ["-C", scenario.storeRoot, "commit", "-m", "correction"]);
  runCommand("git", ["-C", scenario.storeRoot, "push", "origin", "main"]);
  const correctedBaseline = runCommand("git", ["-C", scenario.storeRoot, "rev-parse", "HEAD"]);
  const corrected = await prepareLoad({ ...options, baseline: correctedBaseline });
  const correctedContext = JSON.parse(await fs.readFile(corrected.runtimePath, "utf8"));
  assert.equal(correctedContext.spec_baseline, correctedBaseline);
  assert.equal(runCommand("git", ["rev-parse", "HEAD"], { cwd: correctedContext.spec_root }), correctedBaseline);
  assert.equal(first.runtimePath, corrected.runtimePath);
});

test("prepareLoad recreates a changed immutable worktree on the same Baseline", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  };
  const first = await prepareLoad(options);
  const firstContext = JSON.parse(await fs.readFile(first.runtimePath, "utf8"));
  await fs.writeFile(path.join(firstContext.spec_root, "unexpected.txt"), "changed\n", "utf8");
  const repeated = await prepareLoad(options);
  const repeatedContext = JSON.parse(await fs.readFile(repeated.runtimePath, "utf8"));
  await assert.rejects(fs.stat(path.join(repeatedContext.spec_root, "unexpected.txt")));
  assert.equal(runCommand("git", ["status", "--porcelain"], { cwd: repeatedContext.spec_root }), "");
});

test("prepareLoad restores a missing but still registered immutable worktree", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  };
  const first = await prepareLoad(options);
  const firstContext = JSON.parse(await fs.readFile(first.runtimePath, "utf8"));
  await fs.rm(firstContext.spec_root, { recursive: true, force: true });

  const restored = await prepareLoad(options);
  const restoredContext = JSON.parse(await fs.readFile(restored.runtimePath, "utf8"));
  assert.equal(
    runCommand("git", ["rev-parse", "HEAD"], { cwd: restoredContext.spec_root }),
    scenario.baseline,
  );
  assert.equal(runCommand("git", ["status", "--porcelain"], { cwd: restoredContext.spec_root }), "");
});

test("prepareLoad derives an explicit connect workspace from the Code Repository", async (t) => {
  const scenario = await createScenario(t, { storeInsideWorkspace: false });
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const result = await prepareLoad({
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  });
  assert.equal(
    result.runtimePath.startsWith(path.join(scenario.workspace, ".openspec-orch", "runtime")),
    true,
  );
});

test("prepareLoad uses the current subtask Work Packages after implementation commits", async (t) => {
  const scenario = await createScenario(t);
  const openSpec = fakeOpenSpec(scenario.storeRoot);
  const options = {
    start: scenario.codeRoot,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    changeId: "pay-412-payment-status",
    baseline: scenario.baseline,
    workPackages: ["1"],
    commandRunner: openSpec.runner,
  };
  const first = await prepareLoad(options);
  await fs.writeFile(path.join(scenario.codeRoot, "implementation.txt"), "started\n", "utf8");
  runCommand("git", ["-C", scenario.codeRoot, "add", "implementation.txt"]);
  runCommand("git", ["-C", scenario.codeRoot, "commit", "-m", "implementation"]);
  await prepareLoad({ ...options, workPackages: ["2"] });
  const context = JSON.parse(await fs.readFile(first.runtimePath, "utf8"));
  assert.deepEqual(context.work_packages, ["2"]);
});

test("openspec-orch load CLI returns structured JSON and YAML contracts", async (t) => {
  const scenario = await createScenario(t);
  const fakeBin = path.join(scenario.workspace, "fake-bin");
  const executable = path.join(fakeBin, "openspec");
  await fs.mkdir(fakeBin);
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const storeRoot = ${JSON.stringify(scenario.storeRoot)};
let result;
if (args.join(" ") === "doctor --json") {
  result = { root: { path: storeRoot, source: "declared", store_id: "payments-specs", healthy: true }, status: [] };
} else if (args[0] === "store" && args[1] === "doctor") {
  result = { stores: [{ id: "payments-specs", root: storeRoot, metadata: { present: true, valid: true }, openspec_root: { present: true, healthy: true }, status: [] }], status: [] };
} else if (args[0] === "validate") {
  result = { items: [{ id: "pay-412-payment-status", type: "change", valid: true }], root: { path: process.cwd(), source: "nearest" }, status: [] };
} else if (args[0] === "instructions" && args[1] === "apply") {
  result = { changeName: "pay-412-payment-status", state: "ready", tasks: [{ id: "1", description: "2.1 API", done: false }], root: { path: process.cwd(), source: "nearest" }, status: [] };
} else {
  console.error("unexpected openspec call: " + args.join(" "));
  process.exit(2);
}
console.log(JSON.stringify(result));
`;
  await fs.writeFile(executable, script, "utf8");
  await fs.chmod(executable, 0o755);
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      "load",
      "--store",
      "payments-specs",
      "--repo",
      "payments-api",
      "--change",
      "pay-412-payment-status",
      "--baseline",
      scenario.baseline,
      "--work-package",
      "1",
      "--json",
    ],
    {
      cwd: scenario.codeRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), [
    "step_status",
    "store_id",
    "change_id",
    "spec_baseline",
    "repository_id",
    "implementation_branch",
    "branch_status",
    "code_base_revision",
    "work_packages",
    "selected_tasks",
    "runtime_context",
    "next_step",
    "next_action",
  ]);
  assert.equal(output.step_status, "implementation_ready");
  assert.deepEqual(output.selected_tasks, [{ id: "1", description: "2.1 API" }]);
  assert.equal(typeof output.next_action, "string");

  const textResult = spawnSync(
    process.execPath,
    [
      CLI,
      "load",
      "--store",
      "payments-specs",
      "--repo",
      "payments-api",
      "--change",
      "pay-412-payment-status",
      "--baseline",
      scenario.baseline,
      "--work-package",
      "1",
    ],
    {
      cwd: scenario.codeRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    },
  );
  assert.equal(textResult.status, 0, textResult.stderr);
  const textOutput = parseYaml(textResult.stdout);
  assert.deepEqual(textOutput.selected_tasks, [{ id: "1", description: "2.1 API" }]);
  assert.equal(typeof textOutput.next_action, "string");
});
