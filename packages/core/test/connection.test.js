/** @fileoverview Characterization перенесённой Core connect operation. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { execa } from "execa";

import {
  CandidateCli,
  ConnectionResult,
  ConnectionService,
  CoreStateService,
  CoreConfiguration,
  createRepositoryCheckout,
  GitService,
  OpenSpecService,
  OpenSpecPointerService,
  ProcessService,
  Project,
  Repository,
  StoreProjectService,
  WorkspaceResolver,
} from "@openspec-orch/core";

/** Создаёт Git repository с первым commit. */
async function initializeRepository(root, files = {}) {
  await fs.mkdir(root, { recursive: true });
  await execa("git", ["init", "--initial-branch", "main", root]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  await execa("git", ["-C", root, "add", "."]);
  await execa("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-m",
    "initial",
  ]);
}

/** Собирает независимый Store, Code remote и стандартный workspace. */
async function connectionScenario(t, { codeRepository = true, pointer = false, strict = true } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-candidate-connect-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace");
  const storeRoot = path.join(workspaceRoot, "payments-specs");
  const codeSource = path.join(root, "api-source");
  const codeRemotePath = path.join(root, "api.git");
  const codeRemote = `https://example.test/${path.basename(root)}/api.git`;
  const storeRemote = `https://example.test/${path.basename(root)}/payments-specs.git`;
  await initializeRepository(codeSource, pointer
    ? { "openspec/config.yaml": "store: payments-specs\n" }
    : { "README.md": "api\n" });
  await execa("git", ["clone", "--bare", codeSource, codeRemotePath]);
  const configuration = new CoreConfiguration();
  const project = new Project({
    version: 1,
    strict,
    template: { id: "default" },
    agent: { id: "claude" },
    extensions: [],
    plugins: [],
    repositories: [
      new Repository({
        id: "payments-specs",
        role: "store",
        remote: storeRemote,
        defaultBranch: "main",
        plugins: [],
      }),
      ...(codeRepository ? [new Repository({
        id: "api",
        role: "code",
        remote: codeRemote,
        defaultBranch: "main",
        plugins: [],
      })] : []),
    ],
  });
  await initializeRepository(storeRoot, {
    ".openspec-store/store.yaml": `version: 1\nid: payments-specs\nremote: ${storeRemote}\n`,
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec-orch.yaml": configuration.serializeProject(project),
  });
  await execa("git", ["-C", storeRoot, "remote", "add", "origin", storeRemote]);
  return { root, workspaceRoot, storeRoot, codeRemote, codeRemotePath };
}

/** Создаёт единый fake process executor для Git и OpenSpec. */
function connectExecutor(scenario, { diagnostic } = {}) {
  const calls = [];
  const executor = async (executable, args, options) => {
    if (executable === "git") {
      if (args[0] === "clone" && args.includes(scenario.codeRemote)) {
        const localArgs = args.map((argument) => (
          argument === scenario.codeRemote ? scenario.codeRemotePath : argument
        ));
        const result = await execa(executable, localArgs, options);
        const target = args.at(-1);
        await execa("git", ["-C", target, "remote", "set-url", "origin", scenario.codeRemote]);
        return result;
      }
      return execa(executable, args, options);
    }
    assert.equal(executable, "openspec");
    calls.push({ args, cwd: options.cwd });
    let stdout;
    let stderr = "";
    if (args.join(" ") === "--version") stdout = "1.7.0";
    else if (args[0] === "store" && args[1] === "register") {
      stdout = JSON.stringify({
        store: { id: "payments-specs", root: scenario.storeRoot },
        status: [],
      });
    } else if (args[0] === "store" && args[1] === "doctor") {
      stdout = JSON.stringify({
        stores: [{
          id: "payments-specs",
          root: scenario.storeRoot,
          metadata: { present: true, valid: true },
          openspec_root: { healthy: true },
          status: [],
        }],
        status: [],
      });
    } else if (args[0] === "doctor") {
      stdout = JSON.stringify({
        root: {
          path: options.cwd,
          source: args.includes("--store") ? "store" : "declared",
          status: [],
        },
        store: null,
        references: [],
        status: diagnostic && !args.includes("--store")
          ? [{ code: "project_warning", severity: "warning", message: diagnostic }]
          : [],
      });
    } else if (args[0] === "context") {
      stdout = JSON.stringify({
        root: {
          path: scenario.storeRoot,
          source: args.includes("--store") ? "store" : "declared",
          store_id: "payments-specs",
        },
        status: [],
      });
    } else throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
    return { failed: false, stderr, stdout };
  };
  return { calls, executor };
}

/** Собирает ConnectionService на единой подменяемой process boundary. */
function connectionFixture(executor) {
  const processService = new ProcessService(executor);
  return new ConnectionService({
    gitService: new GitService(processService),
    openSpecService: new OpenSpecService(processService),
    pointerService: new OpenSpecPointerService(),
    stateService: new CoreStateService(),
    storeProjectService: new StoreProjectService(new CoreConfiguration()),
    workspaceService: new WorkspaceResolver(),
  });
}

test("ConnectionService registers Store, clones Repository and creates pointer", async (t) => {
  const scenario = await connectionScenario(t);
  const fake = connectExecutor(scenario, { diagnostic: "project config warning" });
  const progress = [];
  const result = await connectionFixture(fake.executor).connect({
    start: scenario.storeRoot,
    onProgress: (message, status) => progress.push({ message, status }),
  });

  assert.equal(result instanceof ConnectionResult, true);
  assert.equal(result.status, "needs_setup_pr");
  assert.equal(result.executionMode, "strict");
  assert.equal(result.repositories[0].cloned, true);
  assert.equal(result.repositories[0].pointerCreated, true);
  assert.equal(result.repositories[0].pointerPending, true);
  assert.equal(
    await fs.readFile(path.join(scenario.workspaceRoot, "src/api/openspec/config.yaml"), "utf8"),
    "store: payments-specs\n",
  );
  assert.equal(progress.some(({ message }) => message.includes('"references"')), false);
  assert.equal(progress.some(({ message }) => message.includes("project config warning")), true);
  assert.equal(fake.calls.some(({ args }) => args[0] === "store" && args[1] === "register"), true);
});

test("ConnectionService connects a Store without Code Repositories", async (t) => {
  const scenario = await connectionScenario(t, { codeRepository: false });
  const fake = connectExecutor(scenario);

  const result = await connectionFixture(fake.executor).connect({
    start: scenario.storeRoot,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.repositories, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "store" && args[1] === "register"), true);
});

test("ConnectionService is idempotent and remembers explicit nonstandard workspace", async (t) => {
  const scenario = await connectionScenario(t, { pointer: true });
  const customStoreRoot = path.join(scenario.root, "custom-store");
  await fs.rename(scenario.storeRoot, customStoreRoot);
  scenario.storeRoot = customStoreRoot;
  const fake = connectExecutor(scenario);
  const service = connectionFixture(fake.executor);

  const first = await service.connect({
    start: customStoreRoot,
    workspace: scenario.workspaceRoot,
  });
  const second = await service.connect({ start: customStoreRoot });

  assert.equal(first.status, "ready");
  assert.equal(first.repositories[0].cloned, true);
  assert.equal(second.status, "ready");
  assert.equal(second.repositories[0].cloned, false);
  assert.equal(second.repositories[0].pointerCreated, false);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(customStoreRoot, ".openspec-orch/state.json"), "utf8")),
    { contract_version: 1, workspace: scenario.workspaceRoot },
  );
});

test("ConnectionService relaxed mode uses local directory and does not persist workspace", async (t) => {
  const scenario = await connectionScenario(t, { strict: false });
  const checkout = path.join(scenario.workspaceRoot, "src/api");
  await fs.mkdir(checkout, { recursive: true });
  await fs.writeFile(path.join(checkout, "local.txt"), "not Git\n", "utf8");
  const service = connectionFixture(connectExecutor(scenario).executor);

  const result = await service.connect({
    start: scenario.storeRoot,
    workspace: scenario.workspaceRoot,
  });

  assert.equal(result.executionMode, "relaxed");
  assert.equal(result.repositories[0].branch, "unpinned");
  assert.equal(result.repositories[0].revision, "unpinned");
  assert.equal(result.repositories[0].pointerPending, false);
  assert.equal(await fs.lstat(path.join(scenario.storeRoot, ".openspec-orch/state.json"))
    .catch((error) => error.code), "ENOENT");
});

test("ConnectionService fails closed for mixed legacy state before repository mutation", async (t) => {
  const scenario = await connectionScenario(t, { pointer: true });
  await fs.mkdir(path.join(scenario.storeRoot, ".openspec-orch"));
  const statePath = path.join(scenario.storeRoot, ".openspec-orch/state.json");
  const legacy = JSON.stringify({
    contract_version: 1,
    workspace: scenario.workspaceRoot,
    result_receipts: [{ receipt_id: "preserve" }],
  });
  await fs.writeFile(statePath, legacy, "utf8");

  await assert.rejects(
    connectionFixture(connectExecutor(scenario).executor).connect({ start: scenario.storeRoot }),
    /миграция Plugin state/,
  );
  assert.equal(await fs.readFile(statePath, "utf8"), legacy);
  assert.equal(await fs.lstat(path.join(scenario.workspaceRoot, "src"))
    .catch((error) => error.code), "ENOENT");
});

test("OpenSpecPointerService preserves CRLF and local OpenSpec migration guards", async (t) => {
  const scenario = await connectionScenario(t);
  const checkoutRoot = path.join(scenario.root, "pointer-checkout");
  await fs.mkdir(path.join(checkoutRoot, "openspec"), { recursive: true });
  await fs.writeFile(
    path.join(checkoutRoot, "openspec/config.yaml"),
    "store: payments-specs\r\n",
    "utf8",
  );
  const repository = new Repository({
    id: "api",
    role: "code",
    remote: scenario.codeRemote,
    defaultBranch: "main",
    plugins: [],
  });
  const checkout = createRepositoryCheckout(repository, checkoutRoot);
  const service = new OpenSpecPointerService();

  assert.equal(await service.connect(checkout, "payments-specs"), false);
  await fs.mkdir(path.join(checkoutRoot, "openspec/specs"));
  await assert.rejects(service.connect(checkout, "payments-specs"), /требуется отдельная миграция/);
});

test("CandidateCli preserves connect grammar and normalized options", async () => {
  const calls = [];
  const cli = new CandidateCli({
    extensionLifecycle: {
      async preflight() {
        calls.push({ agent: "preflight" });
      },
      async connectSelected() { calls.push({ extensions: "connect" }); },
      async disconnectSelected() { calls.push({ extensions: "disconnect" }); },
      async statusSelected() { calls.push({ extensions: "status" }); },
    },
    connectionService: {
      async connect(options) {
        calls.push(options);
        return {
          storeId: "payments-specs",
          storeRoot: "/workspace/payments-specs",
          workspace: "/workspace",
          executionMode: "relaxed",
          repositories: [],
          status: "ready",
        };
      },
    },
    pluginExtensionConnector: {
      async connectSelected() {
        calls.push({ pluginExtensions: "connect" });
      },
      async disconnectSelected() {
        calls.push({ pluginExtensions: "disconnect" });
      },
      async statusSelected() {
        calls.push({ pluginExtensions: "status" });
      },
    },
  });
  await cli.createProgram().parseAsync([
    "node",
    "openspec-orch",
    "connect",
    "--workspace",
    "/workspace",
    "--no-strict",
  ]);

  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0], { agent: "preflight" });
  assert.equal(calls[1].workspace, "/workspace");
  assert.equal(calls[1].noStrict, true);
  assert.equal(typeof calls[1].onProgress, "function");
  assert.deepEqual(calls[2], { extensions: "connect" });
  assert.deepEqual(calls[3], { pluginExtensions: "connect" });
  assert.deepEqual(calls[4], { extensions: "status" });
  assert.deepEqual(calls[5], { pluginExtensions: "status" });

  calls.length = 0;
  await cli.createProgram().parseAsync(["node", "openspec-orch", "disconnect"]);
  assert.deepEqual(calls, [
    { pluginExtensions: "disconnect" },
    { extensions: "disconnect" },
  ]);
});
