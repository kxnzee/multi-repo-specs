/** @fileoverview Проверка ветвлений парсера аргументов OpenSpec Orchestrator CLI. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  HELP,
  parseChangeArgs,
  parseConnectArgs,
  parseExploreArgs,
  parseInitArgs,
  parseLoadArgs,
} from "../cli/args.js";
import { runChange } from "../cli/change.js";
import { runConnect } from "../cli/connect.js";
import { runExplore } from "../cli/explore.js";
import { runInit } from "../cli/init.js";
import { runLoad } from "../cli/load.js";
import { reportProgress } from "../cli/progress.js";

/**
 * Перехватывает строки `console.log` только на время одного последовательного smoke-сценария.
 *
 * @param {() => Promise<void>} action Проверяемый вызов CLI.
 * @returns {Promise<string[]>} Напечатанные строки.
 */
async function captureLogs(action) {
  const original = console.log;
  const lines = [];
  console.log = (...values) => lines.push(values.join(" "));
  try {
    await action();
  } finally {
    console.log = original;
  }
  return lines;
}

test("rejects unsupported Node versions", () => {
  const entrypoint = pathToFileURL(path.resolve("bin/openspec-orch.js")).href;
  const script = `
    Object.defineProperty(process.versions, "node", { value: "18.20.0" });
    await import(${JSON.stringify(entrypoint)});
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.notEqual(result.stderr, "");
});

test("public binary exposes the documented CLI contract", () => {
  const result = spawnSync(process.execPath, ["bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${HELP}\n`);
});

test("all CLI runners expose the common help without starting project operations", async () => {
  for (const runner of [runInit, runConnect, runExplore, runChange, runLoad]) {
    const lines = await captureLogs(() => runner(["--help"]));
    assert.equal(lines.length, 1);
    assert.equal(typeof lines[0], "string");
    assert.notEqual(lines[0], "");
  }
});

test("parseInitArgs accepts positional and inline options", () => {
  assert.deepEqual(
    parseInitArgs([
      "project",
      "--store=specs",
      "--agent=qwen",
      "--repo=api=https://example.test/api.git#main",
    ]),
    {
      help: false,
      target: "project",
      storeId: "specs",
      agentId: "qwen",
      templateRoot: undefined,
      noStrict: false,
      repositories: [{
        id: "api",
        role: "code",
        url: "https://example.test/api.git",
        defaultBranch: "main",
      }],
    },
  );
  assert.equal(parseInitArgs(["--help"]).help, true);
});

test("parseInitArgs accepts split options and rejects ambiguous input", () => {
  assert.equal(parseInitArgs(["--store", "specs", "--agent", "qwen"]).storeId, "specs");
  assert.equal(
    parseInitArgs(["--store", "specs", "--agent", "team", "--template", "./team-template"]).templateRoot,
    "./team-template",
  );
  assert.equal(parseInitArgs(["--store", "specs", "--agent", "qwen", "--no-strict"]).noStrict, true);
  assert.throws(() => parseInitArgs(["--agent", "qwen"]));
  assert.throws(() => parseInitArgs(["--store", "specs"]));
  assert.throws(() => parseInitArgs(["--store", "specs", "--store=other", "--agent=qwen"]));
  assert.throws(() => parseInitArgs(["--store=specs", "--agent=qwen", "one", "two"]));
  assert.throws(() => parseInitArgs(["--store=specs", "--agent=qwen", "--unknown"]));
  assert.throws(() => parseInitArgs(["--store=specs", "--agent=qwen", "--template=one", "--template=two"]));
});

test("reportProgress writes one event to the selected output", () => {
  let written = "";
  reportProgress("progress-event", {
    write(chunk) {
      written += chunk;
    },
  });
  assert.equal(written, "progress-event\n");
});

test("parseConnectArgs covers help, split and inline workspace", () => {
  assert.deepEqual(parseConnectArgs(["--help"]), { help: true });
  assert.deepEqual(parseConnectArgs(["--workspace", "/tmp/work"]), { help: false, workspace: "/tmp/work", noStrict: false });
  assert.deepEqual(parseConnectArgs(["--workspace=/tmp/work", "--no-strict"]), { help: false, workspace: "/tmp/work", noStrict: true });
  assert.throws(() => parseConnectArgs(["--workspace=/a", "--workspace=/b"]));
  assert.throws(() => parseConnectArgs(["unexpected"]));
});

test("parseExploreArgs covers ticket and workspace variants", () => {
  assert.deepEqual(parseExploreArgs(["--help"]), { help: true });
  assert.deepEqual(
    parseExploreArgs(["--ticket", "PAY-412", "--workspace", "/tmp/work"]),
    { help: false, ticket: "PAY-412", workspace: "/tmp/work", noStrict: false },
  );
  assert.deepEqual(
    parseExploreArgs(["--ticket=PAY-412", "--workspace=/tmp/work"]),
    { help: false, ticket: "PAY-412", workspace: "/tmp/work", noStrict: false },
  );
  assert.deepEqual(
    parseExploreArgs(["--ticket=TEST1-TEST0", "--workspace=/tmp/work"]),
    { help: false, ticket: "TEST1-TEST0", workspace: "/tmp/work", noStrict: false },
  );
  assert.throws(() => parseExploreArgs([]));
  assert.throws(() => parseExploreArgs(["--ticket=pay-412"]));
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "--ticket=PAY-413"]));
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "--workspace=/a", "--workspace=/b"]));
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "unexpected"]));
});

test("parseChangeArgs requires a canonical ticket and short name", () => {
  assert.deepEqual(parseChangeArgs(["--help"]), { help: true });
  assert.deepEqual(
    parseChangeArgs(["--ticket", "PAY-412", "--name", "payment-status"]),
    { help: false, ticket: "PAY-412", name: "payment-status", storeId: undefined, noStrict: false },
  );
  assert.deepEqual(
    parseChangeArgs(["--ticket=PAY-412", "--name=payment-status", "--store=payments-specs"]),
    { help: false, ticket: "PAY-412", name: "payment-status", storeId: "payments-specs", noStrict: false },
  );
  assert.throws(() => parseChangeArgs([]));
  assert.throws(() => parseChangeArgs(["--ticket=PAY-412"]));
  assert.throws(() => parseChangeArgs(["--ticket=pay-412", "--name=payment-status"]));
  assert.throws(() => parseChangeArgs(["--ticket=PAY-412", "--name=PaymentStatus"]));
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name=one", "--store=one", "--store=two"]),
  );
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name=one", "--name=two"]),
  );
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name=one", "unexpected"]),
  );
});

test("parseLoadArgs accepts optional baseline, relaxed mode and unique Work Packages", () => {
  const baseline = "0123456789abcdef0123456789abcdef01234567";
  assert.deepEqual(parseLoadArgs(["--help"]), { help: true });
  assert.deepEqual(
    parseLoadArgs([
      "--store=payments-specs",
      "--repo",
      "payments-api",
      "--change=pay-412-payment-status",
      `--baseline=${baseline}`,
      "--work-package=1",
      "--work-package",
      "task-a",
      "--json",
    ]),
    {
      help: false,
      storeId: "payments-specs",
      repositoryId: "payments-api",
      change: "pay-412-payment-status",
      baseline,
      workPackages: ["1", "task-a"],
      noStrict: false,
      json: true,
    },
  );
  assert.deepEqual(parseLoadArgs([
    "--store=payments-specs",
    "--repo=payments-api",
    "--change=pay-412-payment-status",
    `--baseline=${"a".repeat(40)}`,
  ]).workPackages, []);
  assert.deepEqual(parseLoadArgs([
    "--store=payments-specs",
    "--repo=payments-api",
    "--change=pay-412-payment-status",
    "--no-strict",
  ]), {
    help: false,
    storeId: "payments-specs",
    repositoryId: "payments-api",
    change: "pay-412-payment-status",
    baseline: undefined,
    workPackages: [],
    noStrict: true,
    json: false,
  });
  assert.throws(() => parseLoadArgs([]));
  assert.throws(
    () => parseLoadArgs([
      "--store=payments-specs", "--repo=payments-api", "--change=x", "--baseline=HEAD", "--work-package=1",
    ]),
  );
  assert.throws(
    () => parseLoadArgs([
      "--change=x",
      "--store=payments-specs",
      "--repo=payments-api",
      `--baseline=${baseline}`,
      "--work-package=1",
      "--work-package=1",
    ]),
  );
  assert.throws(
    () => parseLoadArgs([
      "--store=payments-specs", "--repo=payments-api", "--change=x", `--baseline=${baseline}`,
      "--work-package", "--json",
    ]),
  );
});

test("split CLI options reject another long option instead of consuming it as a value", () => {
  assert.throws(
    () => parseInitArgs(["--store", "--agent", "qwen"]),
  );
  assert.throws(
    () => parseConnectArgs(["--workspace", "--help"]),
  );
  assert.throws(
    () => parseExploreArgs(["--ticket", "--workspace", "/tmp/work"]),
  );
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name", "--help"]),
  );
});
