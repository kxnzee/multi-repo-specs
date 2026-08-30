/** @fileoverview Regression contract for the shared CLI/MCP Project setup application. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProjectSetupService } from "../internal/project-setup.js";

const templates = Object.freeze({
  defaultId: "base",
  catalog: Object.freeze({ entries: Object.freeze([]) }),
  resolve(id) { return Object.freeze({ id, root: `/templates/${id}` }); },
});

/** Creates one complete lifecycle double that records calls. */
function lifecycle(name, calls) {
  return Object.freeze({
    async preflight() { calls.push(`${name}:preflight`); },
    async connectSelected() { calls.push(`${name}:connect`); },
    async statusSelected() { calls.push(`${name}:status`); },
    async disconnectSelected() { calls.push(`${name}:disconnect`); },
  });
}

test("ProjectSetupService gives CLI and MCP one strict fixed-cwd setup sequence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-project-setup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const selections = [];
  const initializations = [];
  const extension = lifecycle("extension", calls);
  const pluginExtension = lifecycle("plugin", calls);
  const service = new ProjectSetupService({
    bundledTemplateProvider: templates,
    connectionService: Object.freeze({
      async connect(options) {
        calls.push("core:connect");
        assert.equal(options.start, root);
        assert.equal(options.workspace, undefined);
        assert.equal(options.noStrict, false);
        return {
          storeId: "specs",
          storeRoot: root,
          workspace: path.dirname(root),
          executionMode: "strict",
          status: "ready",
          repositories: [],
        };
      },
    }),
    extensionLifecycle: extension,
    initializationService: Object.freeze({
      async initialize(options) {
        initializations.push(options);
        return {
          target: root,
          storeId: "specs",
          alreadyInitialized: false,
          executionMode: "strict",
          created: ["openspec-orch.yaml"],
          updated: [],
          agent: Object.freeze({ id: "qwen" }),
        };
      },
    }),
    initSelectionService: Object.freeze({
      async resolve(options) {
        selections.push(options);
        return Object.freeze({
          storeId: options.store,
          agentId: options.agent,
          template: options.template ?? "base",
          extensions: Object.freeze([]),
          extensionsSpecified: false,
          repositories: options.repo,
          noStrict: options.strict !== true,
        });
      },
    }),
    pluginExtensionConnector: pluginExtension,
    start: root,
    storeProjectService: Object.freeze({
      async load() { throw new Error("load не ожидается для нового Project"); },
      async resolve() { return Object.freeze({ project: Object.freeze({ strict: true }) }); },
    }),
  });

  const initialized = await service.initializeExplicit({
    storeId: "specs",
    agentId: "qwen",
    templateId: "base",
    repositories: [{
      id: "frontend",
      role: "code",
      remote: "ssh://git.example/frontend.git",
      defaultBranch: "main",
    }],
  });
  assert.deepEqual(selections, [{
    agent: "qwen",
    repo: [{
      id: "frontend",
      role: "code",
      remote: "ssh://git.example/frontend.git",
      defaultBranch: "main",
    }],
    store: "specs",
    strict: true,
    template: "base",
  }]);
  assert.equal(initializations[0].target, root);
  assert.equal(initializations[0].noStrict, false);
  assert.equal(initializations[0].replaceExtensions, false);
  assert.equal(initialized.execution_mode, "strict");

  const connected = await service.connect({ requireStrict: true });
  assert.equal(connected.status, "ready");
  assert.deepEqual(calls, [
    "extension:preflight",
    "core:connect",
    "extension:connect",
    "plugin:connect",
    "extension:status",
    "plugin:status",
  ]);
});

test("ProjectSetupService rejects an existing relaxed Project before initialization writes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-project-setup-relaxed-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.writeFile(path.join(root, ".openspec-store/store.yaml"), "version: 1\n");
  let initializationCalled = false;
  const service = new ProjectSetupService({
    bundledTemplateProvider: templates,
    connectionService: Object.freeze({ async connect() { return {}; } }),
    initializationService: Object.freeze({
      async initialize() {
        initializationCalled = true;
        return {};
      },
    }),
    initSelectionService: Object.freeze({ async resolve() { return {}; } }),
    start: root,
    storeProjectService: Object.freeze({
      async load() { return Object.freeze({ project: Object.freeze({ strict: false }) }); },
      async resolve() { return Object.freeze({ project: Object.freeze({ strict: false }) }); },
    }),
  });

  await assert.rejects(
    service.initializeExplicit({ storeId: "specs", agentId: "qwen" }),
    /MCP_SETUP_STRICT_REQUIRED/u,
  );
  assert.equal(initializationCalled, false);
});
