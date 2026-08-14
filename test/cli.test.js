/** @fileoverview Проверка декларативного контракта OpenSpec Orchestrator CLI. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { confirm } from "../src/cli/prompt.js";
import { createProgram } from "../src/cli/program.js";
import { reportProgress } from "../src/cli/progress.js";

/**
 * Разбирает одну команду без запуска production-сценария.
 *
 * @param {string[]} args Аргументы начиная с имени команды.
 * @returns {Promise<{name: string, options: Record<string, unknown>} | undefined>} Нормализованный вызов.
 */
async function parseCommand(args) {
  let invocation;
  const handler = (name) => async (options) => {
    invocation = { name, options };
  };
  const program = createProgram({
    init: handler("init"),
    connect: handler("connect"),
    explore: handler("explore"),
    change: handler("change"),
    load: handler("load"),
  });
  for (const command of [program, ...program.commands]) {
    command.configureOutput({ writeOut() {}, writeErr() {} });
  }
  await program.parseAsync(args, { from: "user" });
  return invocation;
}

test("rejects unsupported Node versions", () => {
  const entrypoint = pathToFileURL(path.resolve("src/bin/openspec-orch.js")).href;
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

test("public binary exposes generated help", () => {
  const result = spawnSync(process.execPath, ["src/bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Usage: openspec-orch/m);
  for (const command of ["init", "connect", "explore", "change", "load"]) {
    assert.match(result.stdout, new RegExp(`^  ${command}`, "m"));
  }
});

test("every subcommand exposes generated help without running its action", () => {
  for (const command of ["init", "connect", "explore", "change", "load"]) {
    const result = spawnSync(
      process.execPath,
      ["src/bin/openspec-orch.js", command, "--help"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Usage: openspec-orch ${command}`, "m"));
  }
});

test("init command normalizes positional and repeated repository options", async () => {
  assert.deepEqual(
    await parseCommand([
      "init",
      "project",
      "--store=specs",
      "--agent=qwen",
      "--repo=api=https://example.test/api.git#main",
      "--template=./team-template",
      "--no-strict",
    ]),
    {
      name: "init",
      options: {
        target: "project",
        storeId: "specs",
        agentId: "qwen",
        templateRoot: "./team-template",
        noStrict: true,
        repositories: [{
          id: "api",
          role: "code",
          url: "https://example.test/api.git",
          defaultBranch: "main",
        }],
      },
    },
  );
});

test("init command accepts split options and applies stable defaults", async () => {
  assert.deepEqual(
    await parseCommand(["init", "--store", "specs", "--agent", "qwen"]),
    {
      name: "init",
      options: {
        target: ".",
        storeId: "specs",
        agentId: "qwen",
        templateRoot: undefined,
        repositories: [],
        noStrict: false,
      },
    },
  );
});

test("connect and explore commands normalize shared options", async () => {
  assert.deepEqual(
    await parseCommand(["connect", "--workspace=/tmp/work", "--no-strict"]),
    { name: "connect", options: { workspace: "/tmp/work", noStrict: true } },
  );
  assert.deepEqual(
    await parseCommand(["explore", "--ticket=TEST1-TEST0", "--workspace=/tmp/work"]),
    {
      name: "explore",
      options: { ticket: "TEST1-TEST0", workspace: "/tmp/work", noStrict: false },
    },
  );
});

test("change command validates identifiers", async () => {
  assert.deepEqual(
    await parseCommand([
      "change",
      "--ticket=PAY-412",
      "--name=payment-status",
      "--store=payments-specs",
    ]),
    {
      name: "change",
      options: {
        ticket: "PAY-412",
        name: "payment-status",
        storeId: "payments-specs",
        noStrict: false,
      },
    },
  );
  await assert.rejects(parseCommand(["change", "--ticket=pay-412", "--name=payment-status"]));
  await assert.rejects(parseCommand(["change", "--ticket=PAY-412", "--name=PaymentStatus"]));
});

test("load command collects unique Work Packages", async () => {
  const baseline = "0123456789abcdef0123456789abcdef01234567";
  assert.deepEqual(
    await parseCommand([
      "load",
      "--store=payments-specs",
      "--repo=payments-api",
      "--change=pay-412-payment-status",
      `--baseline=${baseline}`,
      "--work-package=1",
      "--work-package=task-a",
      "--json",
    ]),
    {
      name: "load",
      options: {
        storeId: "payments-specs",
        repositoryId: "payments-api",
        change: "pay-412-payment-status",
        baseline,
        workPackages: ["1", "task-a"],
        noStrict: false,
        json: true,
      },
    },
  );
  await assert.rejects(parseCommand([
    "load",
    "--store=payments-specs",
    "--repo=payments-api",
    "--change=pay-412-payment-status",
    "--work-package=1",
    "--work-package=1",
  ]));
});

test("Commander rejects missing, duplicate and unknown options", async () => {
  await assert.rejects(parseCommand(["init", "--agent=qwen"]));
  await assert.rejects(parseCommand(["init", "--store=specs"]));
  await assert.rejects(parseCommand([
    "init",
    "--store=specs",
    "--store=other",
    "--agent=qwen",
  ]));
  await assert.rejects(parseCommand([
    "init",
    "--store=specs",
    "--agent=qwen",
    "--unknown",
  ]));
  await assert.rejects(parseCommand(["connect", "--workspace", "--help"]));
});

test("Commander rejects invalid baseline and missing split values", async () => {
  await assert.rejects(parseCommand([
    "load",
    "--store=payments-specs",
    "--repo=payments-api",
    "--change=pay-412-payment-status",
    "--baseline=HEAD",
  ]));
  await assert.rejects(parseCommand(["explore", "--ticket", "--workspace", "/tmp/work"]));
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

test("confirm retries invalid input and accepts localized answers", async () => {
  const answers = ["maybe", "да"];
  const issues = [];
  const accepted = await confirm(
    { question: async () => answers.shift() },
    "Продолжить?",
    (message) => issues.push(message),
  );
  assert.equal(accepted, true);
  assert.deepEqual(issues, ["Введите yes/да или no/нет."]);
  assert.equal(await confirm({ question: async () => "" }, "Продолжить?"), false);
});
