/** @fileoverview Проверка ветвлений парсера аргументов SDD CLI. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  parseChangeArgs,
  parseConnectArgs,
  parseExploreArgs,
  parseInitArgs,
  parseLoadArgs,
} from "../cli/args.js";

test("rejects unsupported Node versions", () => {
  const entrypoint = pathToFileURL(path.resolve("bin/sdd.js")).href;
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
  assert.match(result.stderr, /Node\.js 20/);
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
  assert.throws(() => parseInitArgs(["--agent", "qwen"]), /требуется --store/);
  assert.throws(() => parseInitArgs(["--store", "specs"]), /требуется --agent/);
  assert.throws(() => parseInitArgs(["--store", "specs", "--store=other", "--agent=qwen"]), /только один раз/);
  assert.throws(() => parseInitArgs(["--store=specs", "--agent=qwen", "one", "two"]), /Неожиданный аргумент/);
  assert.throws(() => parseInitArgs(["--store=specs", "--agent=qwen", "--unknown"]), /Неизвестный параметр/);
});

test("parseConnectArgs covers help, split and inline workspace", () => {
  assert.deepEqual(parseConnectArgs(["--help"]), { help: true });
  assert.deepEqual(parseConnectArgs(["--workspace", "/tmp/work"]), { help: false, workspace: "/tmp/work" });
  assert.deepEqual(parseConnectArgs(["--workspace=/tmp/work"]), { help: false, workspace: "/tmp/work" });
  assert.throws(() => parseConnectArgs(["--workspace=/a", "--workspace=/b"]), /только один раз/);
  assert.throws(() => parseConnectArgs(["unexpected"]), /Неизвестный параметр connect/);
});

test("parseExploreArgs covers ticket and workspace variants", () => {
  assert.deepEqual(parseExploreArgs(["--help"]), { help: true });
  assert.deepEqual(
    parseExploreArgs(["--ticket", "PAY-412", "--workspace", "/tmp/work"]),
    { help: false, ticket: "PAY-412", workspace: "/tmp/work" },
  );
  assert.deepEqual(
    parseExploreArgs(["--ticket=PAY-412", "--workspace=/tmp/work"]),
    { help: false, ticket: "PAY-412", workspace: "/tmp/work" },
  );
  assert.throws(() => parseExploreArgs([]), /требуется --ticket/);
  assert.throws(() => parseExploreArgs(["--ticket=pay-412"]), /Ticket key/);
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "--ticket=PAY-413"]), /только один раз/);
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "--workspace=/a", "--workspace=/b"]), /только один раз/);
  assert.throws(() => parseExploreArgs(["--ticket=PAY-412", "unexpected"]), /Неизвестный параметр explore/);
});

test("parseChangeArgs requires a canonical ticket and short name", () => {
  assert.deepEqual(parseChangeArgs(["--help"]), { help: true });
  assert.deepEqual(
    parseChangeArgs(["--ticket", "PAY-412", "--name", "payment-status"]),
    { help: false, ticket: "PAY-412", name: "payment-status" },
  );
  assert.deepEqual(
    parseChangeArgs(["--ticket=PAY-412", "--name=payment-status"]),
    { help: false, ticket: "PAY-412", name: "payment-status" },
  );
  assert.throws(() => parseChangeArgs([]), /требуется --ticket/);
  assert.throws(() => parseChangeArgs(["--ticket=PAY-412"]), /требуется --name/);
  assert.throws(() => parseChangeArgs(["--ticket=pay-412", "--name=payment-status"]), /Ticket key/);
  assert.throws(() => parseChangeArgs(["--ticket=PAY-412", "--name=PaymentStatus"]), /lowercase kebab-case/);
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name=one", "--name=two"]),
    /только один раз/,
  );
  assert.throws(
    () => parseChangeArgs(["--ticket=PAY-412", "--name=one", "unexpected"]),
    /Неизвестный параметр change/,
  );
});

test("parseLoadArgs requires exact baseline and explicit unique Work Packages", () => {
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
      json: true,
    },
  );
  assert.throws(() => parseLoadArgs([]), /требуется --store/);
  assert.throws(
    () => parseLoadArgs([
      "--store=payments-specs", "--repo=payments-api", "--change=x", `--baseline=${baseline}`,
    ]),
    /хотя бы один --work-package/,
  );
  assert.throws(
    () => parseLoadArgs([
      "--store=payments-specs", "--repo=payments-api", "--change=x", "--baseline=HEAD", "--work-package=1",
    ]),
    /40-символьной SHA/,
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
    /передан дважды/,
  );
  assert.throws(
    () => parseLoadArgs([
      "--store=payments-specs", "--repo=payments-api", "--change=x", `--baseline=${baseline}`,
      "--work-package", "--json",
    ]),
    /требуется task.id/,
  );
});
