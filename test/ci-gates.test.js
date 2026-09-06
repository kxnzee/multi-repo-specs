/** @fileoverview Positive and fail-closed checks for free CI gates. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { blockingFindings } from "../scripts/check-sarif.js";
import coverageGate, { coverageFailures, CRITICAL_BRANCH_FLOORS } from "../scripts/coverage-gate.js";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

/** Creates an isolated report directory. */
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ci-gate-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Builds a minimal CodeQL-shaped SARIF report. */
function sarif(severity = "7.0", level = "warning") {
  return { version: "2.1.0", runs: [{
    tool: { driver: { rules: [{ id: "test/rule", properties: { "security-severity": severity },
      defaultConfiguration: { level } }] } },
    results: [{ ruleId: "test/rule" }],
  }] };
}

test("critical coverage accepts exact floors and fails missing, invalid or regressed metrics", () => {
  const summary = { files: Object.entries(CRITICAL_BRANCH_FLOORS).map(([file, minimum]) => ({
    path: path.join(root, file), coveredBranchPercent: minimum,
  })) };
  assert.deepEqual(coverageFailures(summary), []);
  summary.files[0].coveredBranchPercent -= 0.01;
  assert.equal(coverageFailures(summary).length, 1);
  summary.files[0].coveredBranchPercent = NaN;
  assert.equal(coverageFailures(summary).length, 1);
  summary.files.shift();
  assert.match(coverageFailures(summary)[0], /missing/);
  assert.equal(coverageFailures({}).length, 1);
});

test("coverage reporter fails closed when Node sends no coverage summary", async () => {
  await assert.rejects(async () => {
    for await (const output of coverageGate([{ type: "test:pass" }])) assert.fail(output);
  }, /no coverage event/);
});

test("native Node runner exits nonzero when critical coverage is missing", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "minimal.test.mjs");
  await fs.writeFile(file, 'import test from "node:test"; test("passes", () => {});');
  const environment = { ...process.env };
  delete environment.GITHUB_STEP_SUMMARY;
  delete environment.NODE_TEST_CONTEXT;
  await assert.rejects(execute(process.execPath, [
    "--experimental-test-coverage", "--test-reporter", new URL("../scripts/coverage-gate.js", import.meta.url).href,
    "--test", file,
  ], { cwd: directory, env: environment, timeout: 30000 }), (error) => {
    assert.equal(typeof error.code, "number");
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /COVERAGE_GATE_FAILED/);
    return true;
  });
});

test("SARIF gate blocks high, critical and error-level findings but accepts medium", () => {
  for (const severity of ["7.0", "9.8"]) assert.equal(blockingFindings(sarif(severity)).length, 1);
  assert.deepEqual(blockingFindings(sarif("6.9")), []);
  assert.equal(blockingFindings(sarif("0", "error")).length, 1);
  const report = sarif();
  report.runs[0].results = [{ ruleIndex: 0 }];
  assert.equal(blockingFindings(report).length, 1);
  report.runs[0].results = [];
  assert.deepEqual(blockingFindings(report), []);
});

test("SARIF gate rejects malformed reports, unknown rules and unsuccessful analysis", () => {
  for (const report of [{}, { version: "2.1.0", runs: [] },
    { version: "2.1.0", runs: [{}] }, sarif("not-a-number")]) {
    assert.throws(() => blockingFindings(report), /SARIF_INVALID/);
  }
  const report = sarif();
  report.runs[0].results = [{ ruleId: "unknown" }];
  assert.throws(() => blockingFindings(report), /matching rule/);
  report.runs[0].results = [];
  report.runs[0].invocations = [{ executionSuccessful: false }];
  assert.throws(() => blockingFindings(report), /invocation failed/);
});

test("SARIF gate resolves CodeQL query-pack rules without confusing identical driver indices", () => {
  const report = sarif("0");
  const run = report.runs[0];
  run.tool.extensions = [{ name: "codeql/javascript-queries", guid: "query-pack",
    rules: sarif("9.8").runs[0].tool.driver.rules }];
  run.results = [{ ruleId: "test/rule", ruleIndex: 0,
    rule: { index: 0, toolComponent: { index: 0 } } }];
  assert.equal(blockingFindings(report).length, 1);
  delete run.tool.driver.rules;
  assert.equal(blockingFindings(report).length, 1);
  run.results[0].rule.toolComponent = { guid: "query-pack" };
  assert.equal(blockingFindings(report).length, 1);
  run.results[0].rule.toolComponent = { index: 99 };
  assert.throws(() => blockingFindings(report), /matching rule component/);
  run.results = [];
  assert.deepEqual(blockingFindings(report), []);
});

test("SARIF gate fails closed for conflicting rule IDs and indices", () => {
  for (const reference of [{ id: "other" }, { index: 1 }, { index: -1 }]) {
    const report = sarif();
    report.runs[0].results[0] = { ruleId: "test/rule", ruleIndex: 0, rule: reference };
    assert.throws(() => blockingFindings(report), /SARIF_INVALID/);
  }
});

test("SARIF CLI rejects missing output and findings in any report, accepts a clean scan", async (t) => {
  const directory = await fixture(t);
  const args = [path.join(root, "scripts/check-sarif.js"), directory];
  await assert.rejects(execute(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /SARIF_MISSING/);
    return true;
  });
  await fs.writeFile(path.join(directory, "clean.sarif"), JSON.stringify(sarif("5.0")));
  assert.match((await execute(process.execPath, args)).stdout, /Security gate passed/);
  await fs.writeFile(path.join(directory, "high.sarif"), JSON.stringify(sarif()));
  await assert.rejects(execute(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /SECURITY_GATE_FAILED/);
    return true;
  });
});
