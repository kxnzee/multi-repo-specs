/** @fileoverview Read-only Doctor aggregation and CLI contract. */

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { createCliProgress } from "@openspec-orch/plugin-sdk";

import {
  CandidateCli,
  DiagnosticReport,
  DiagnosticResult,
  DoctorService,
} from "@openspec-orch/core";

test("DoctorService reuses read-only status services and keeps checking after failures", async () => {
  const calls = [];
  const storeProject = Object.freeze({
    checkout: Object.freeze({ root: "/workspace/specs" }),
    root: "/workspace/specs",
    store: Object.freeze({ id: "specs" }),
  });
  const service = new DoctorService({
    start: "/workspace/specs",
    storeProjectService: {
      async resolve(start) {
        calls.push(["store", start]);
        return storeProject;
      },
    },
    packageSupplyService: {
      forStore(checkout) {
        assert.equal(checkout, storeProject.checkout);
        return {
          async inspect() {
            calls.push(["packages"]);
            return {
              state: "stale",
              runtimeRoot: "/workspace/specs/.openspec-orch/packages",
              packages: [{ id: "sample" }],
              available: 1,
              mutable: 0,
            };
          },
        };
      },
    },
    openSpecService: {
      forRepository(checkout) {
        assert.equal(checkout, storeProject.checkout);
        return {
          async version() {
            calls.push(["openspec-version"]);
            return "1.10.0";
          },
          async assertStoreHealthy() {
            calls.push(["openspec-store"]);
          },
          async doctor(_args, onDiagnostic) {
            calls.push(["openspec-doctor"]);
            onDiagnostic("Using OpenSpec root: /workspace/specs", "info");
            return "OpenSpec configuration is valid";
          },
          async assertContext(options) {
            calls.push(["openspec-context", options]);
          },
          async registerStore() {
            assert.fail("Doctor must not register Store");
          },
        };
      },
    },
    repositoryStatusService: {
      async inspect(options) {
        calls.push(["repositories", options]);
        return [
          {
            id: "specs",
            role: "store",
            state: "connected",
            path: "/workspace/specs",
            branch: "team/story-work",
            remote: "https://example.test/specs.git",
            remoteMatches: true,
            clean: true,
          },
          { id: "frontend", role: "code", state: "connected", clean: false },
          { id: "backend", role: "code", state: "missing", clean: undefined },
        ];
      },
    },
    extensionStatusService: {
      async diagnoseSelected() {
        calls.push(["extensions"]);
        return [
          {
            extensionId: "spec-driven-extended",
            targetId: "specs",
            state: "unavailable",
            output: "EXTENSION_NATIVE_FAILED: spec-driven-extended unavailable",
          },
          {
            extensionId: "superpowers",
            targetId: "specs",
            state: "ready",
            output: "enabled",
          },
        ];
      },
    },
    pluginStatusService: {
      async statuses() {
        calls.push(["plugins"]);
        return [
          { pluginId: "codegraph", repositoryId: "frontend", state: "ready", output: "" },
          {
            pluginId: "sample",
            repositoryId: "backend",
            state: "unavailable",
            output: "PLUGIN_NOT_LOADED: runtime missing",
          },
        ];
      },
    },
  });

  const stages = [];
  const report = await service.inspect({
    repositoryIds: ["specs"],
    onProgress: (message) => {
      stages.push(message);
      calls.push(["progress", message]);
    },
  });

  assert.deepEqual(stages, [
    "Проверка Store...", "Проверка Store packages...", "Проверка OpenSpec...",
    "Проверка Repositories...", "Проверка Standalone Extensions...", "Проверка Plugins...",
  ]);
  for (const [index, operation] of [
    "store", "packages", "openspec-version", "repositories", "extensions", "plugins",
  ].entries()) {
    assert.ok(calls.findIndex(([name, text]) => name === "progress" && text === stages[index]) <
      calls.findIndex(([name]) => name === operation));
  }

  assert.equal(report instanceof DiagnosticReport, true);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.summary, { pass: 5, warning: 2, error: 3, skipped: 0 });
  assert.deepEqual(report.checks.map(({ id, outcome }) => ({ id, outcome })), [
    { id: "store", outcome: "pass" },
    { id: "packages", outcome: "warning" },
    { id: "openspec", outcome: "pass" },
    { id: "repository:specs", outcome: "pass" },
    { id: "repository:frontend", outcome: "warning" },
    { id: "repository:backend", outcome: "error" },
    { id: "extension:spec-driven-extended:specs", outcome: "error" },
    { id: "extension:superpowers:specs", outcome: "pass" },
    { id: "plugin:codegraph:frontend", outcome: "pass" },
    { id: "plugin:sample:backend", outcome: "error" },
  ]);
  assert.equal(calls.some(([operation]) => operation === "plugins"), true);
  assert.equal(calls.some(([operation]) => operation === "extensions"), true);
  assert.equal(report.checks[1].code, "PACKAGE_RUNTIME_STALE");
  assert.deepEqual(
    calls.find(([operation]) => operation === "repositories"),
    ["repositories", { start: "/workspace/specs", repositoryIds: ["specs"] }],
  );
  assert.deepEqual(report.checks[3].details, {
    state: "connected",
    path: "/workspace/specs",
    branch: "team/story-work",
    remote: "https://example.test/specs.git",
    remote_matches: true,
    clean: true,
  });
});

test("DoctorService reports Store failure and marks dependent checks as skipped", async () => {
  const service = new DoctorService({
    storeProjectService: {
      async resolve() {
        throw Object.assign(new Error("Store not found"), { code: "STORE_ROOT_NOT_FOUND" });
      },
    },
    openSpecService: { forRepository: () => assert.fail("OpenSpec must be skipped") },
    repositoryStatusService: { inspect: () => assert.fail("Repositories must be skipped") },
  });

  const report = await service.inspect();

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.summary, { pass: 0, warning: 0, error: 1, skipped: 5 });
  assert.equal(report.checks[0].code, "STORE_ROOT_NOT_FOUND");
  assert.deepEqual(report.checks.slice(1).map(({ id, outcome }) => ({ id, outcome })), [
    { id: "packages", outcome: "skipped" },
    { id: "openspec", outcome: "skipped" },
    { id: "repositories", outcome: "skipped" },
    { id: "extensions", outcome: "skipped" },
    { id: "plugins", outcome: "skipped" },
  ]);
});

test("DiagnosticReport cannot be ready while a check is skipped", () => {
  const report = new DiagnosticReport([
    new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }),
    new DiagnosticResult({ id: "plugins", subject: "Plugins", outcome: "skipped" }),
  ]);

  assert.equal(report.status, "degraded");
  assert.deepEqual(report.summary, { pass: 1, warning: 0, error: 0, skipped: 1 });
});

test("CandidateCli doctor renders human and JSON output from the same report", async (t) => {
  const calls = [];
  const report = new DiagnosticReport([
    new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }),
    new DiagnosticResult({
      id: "repository:frontend",
      subject: "Repository frontend [code]",
      outcome: "pass",
      details: {
        state: "connected",
        path: "/workspace/frontend",
        branch: "team/custom-work",
        remote_matches: true,
        clean: true,
      },
    }),
    new DiagnosticResult({
      id: "plugin:sample:frontend",
      subject: "Plugin sample → frontend",
      outcome: "error",
      code: "PLUGIN_UNAVAILABLE",
      message: "runtime missing",
    }),
  ]);
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  const cli = new CandidateCli({
    doctorService: {
      async inspect(options) {
        calls.push({ repositoryIds: options.repositoryIds });
        return report;
      },
    },
  });

  await cli.createProgram().parseAsync(["node", "openspec-orch", "doctor"]);
  assert.deepEqual(output, [
    [
      "OpenSpec Orchestrator Doctor",
      "────────────────────────────",
      "",
      "✗ Есть блокирующие ошибки",
      "",
      "Результат",
      "  ✓ Успешно          2",
      "  ⚠ Предупреждения   0",
      "  ✗ Ошибки           1",
      "  • Пропущено        0",
      "",
      "Проверки",
      "  ✓ Store",
      "  ✓ Repository frontend [code]",
      "      ├─ state: connected",
      "      ├─ path: /workspace/frontend",
      "      ├─ branch: team/custom-work",
      "      ├─ remote matches: да",
      "      └─ clean: да",
      "  ✗ Plugin sample → frontend",
      "      Код: PLUGIN_UNAVAILABLE",
      "      runtime missing",
      "",
      "Дальше",
      "  Исправьте блокирующие ошибки и повторите:",
      "    openspec-orch doctor",
    ].join("\n"),
  ]);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(calls, [{ repositoryIds: [] }]);

  output.length = 0;
  process.exitCode = undefined;
  await cli.createProgram().parseAsync([
    "node", "openspec-orch", "doctor",
    "--repo", "frontend",
    "--repo", "backend",
  ]);
  assert.match(output[0], /Repository frontend \[code\][\s\S]*branch: team\/custom-work/u);
  assert.deepEqual(calls.at(-1), { repositoryIds: ["frontend", "backend"] });

  output.length = 0;
  process.exitCode = undefined;
  await cli.createProgram().parseAsync(["node", "openspec-orch", "doctor", "--json"]);
  assert.deepEqual(JSON.parse(output[0]), report.toJSON());
  assert.equal(process.exitCode, 1);
  assert.equal(cli.createProgram().commands.some((command) => command.name() === "repository"), false);
});

for (const isTTY of [false, true]) {
  for (const status of ["ready", "degraded", "blocked", "error"]) {
    test(`Doctor progress is visible while pending and stops for ${status} (TTY=${isTTY})`, async (t) => {
      t.mock.timers.enable({ apis: ["setInterval"] });
      const output = [];
      const stdout = [];
      t.mock.method(console, "log", (value) => stdout.push(value));
      const previousExitCode = process.exitCode;
      t.after(() => { process.exitCode = previousExitCode; });
      const progress = createCliProgress({ output: {
        isTTY, write: (value) => output.push(value),
      } });
      const { promise, resolve, reject } = Promise.withResolvers();
      const cli = new CandidateCli({
        progress,
        doctorService: {
          async inspect({ onProgress }) {
            assert.ok(output.length > 0, "progress must start before diagnostics");
            onProgress("Проверка OpenSpec...");
            return promise;
          },
        },
      });
      const running = cli.createProgram().parseAsync(["node", "openspec-orch", "doctor"]);
      assert.match(output.join(""), /Проверка OpenSpec/u);
      assert.deepEqual(stdout, []);
      if (isTTY) {
        const previous = output.at(-1);
        t.mock.timers.tick(80);
        assert.notEqual(output.at(-1), previous, "spinner must animate during the wait");
      } else {
        assert.ok(output.every((line) => line.endsWith("\n") && !line.includes("\u001b")));
      }
      if (status === "error") {
        reject(new Error("probe failed"));
        await assert.rejects(running, /probe failed/u);
        assert.deepEqual(stdout, []);
      } else {
        const outcome = { ready: "pass", degraded: "warning", blocked: "error" }[status];
        resolve(new DiagnosticReport([new DiagnosticResult({ id: "store", subject: "Store", outcome })]));
        await running;
        assert.equal(process.exitCode, status === "blocked" ? 1 : 0);
        assert.equal(stdout.length, 1);
      }
      assert.equal(progress.active, false);
      assert.match(output.at(-1), status === "ready" ? /✓/u : status === "degraded" ? /⚠/u : /✗/u);
      const length = output.length;
      t.mock.timers.tick(800);
      assert.equal(output.length, length, "no spinner frames after completion or failure");
    });
  }
}

test("Doctor JSON mode never starts progress even with TTY stderr", async (t) => {
  const stderr = [];
  const stdout = [];
  t.mock.method(console, "log", (value) => stdout.push(value));
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  const report = new DiagnosticReport([
    new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }),
  ]);
  const cli = new CandidateCli({
    progress: createCliProgress({ output: { isTTY: true, write: (value) => stderr.push(value) } }),
    doctorService: {
      async inspect(options) {
        assert.deepEqual(options, { repositoryIds: [] });
        return report;
      },
    },
  });
  await cli.createProgram().parseAsync(["node", "openspec-orch", "doctor", "--json"]);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0]), report.toJSON());
});
