/** @fileoverview Read-only Doctor aggregation and CLI contract. */

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

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
          { id: "specs", role: "store", state: "connected", clean: true },
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

  const report = await service.inspect();

  assert.equal(report instanceof DiagnosticReport, true);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.summary, { pass: 5, warning: 1, error: 3, skipped: 0 });
  assert.deepEqual(report.checks.map(({ id, outcome }) => ({ id, outcome })), [
    { id: "store", outcome: "pass" },
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
  assert.deepEqual(report.summary, { pass: 0, warning: 0, error: 1, skipped: 4 });
  assert.equal(report.checks[0].code, "STORE_ROOT_NOT_FOUND");
  assert.deepEqual(report.checks.slice(1).map(({ id, outcome }) => ({ id, outcome })), [
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
  const report = new DiagnosticReport([
    new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }),
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
  const cli = new CandidateCli({ doctorService: { inspect: async () => report } });

  await cli.createProgram().parseAsync(["node", "openspec-orch", "doctor"]);
  assert.deepEqual(output, [
    [
      "OpenSpec Orchestrator Doctor",
      "────────────────────────────",
      "",
      "✗ Есть блокирующие ошибки",
      "",
      "Результат",
      "  ✓ Успешно          1",
      "  ⚠ Предупреждения   0",
      "  ✗ Ошибки           1",
      "  • Пропущено        0",
      "",
      "Проверки",
      "  ✓ Store",
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

  output.length = 0;
  process.exitCode = undefined;
  await cli.createProgram().parseAsync(["node", "openspec-orch", "doctor", "--json"]);
  assert.deepEqual(JSON.parse(output[0]), report.toJSON());
  assert.equal(process.exitCode, 1);
});
