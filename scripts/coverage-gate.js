/** @fileoverview Per-file coverage floors for critical runtime boundaries. */

import { appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
export const CRITICAL_BRANCH_FLOORS = Object.freeze({
  "agents/native-extension.js": 94,
  "packages/core/internal/initialization.js": 70,
  "packages/core/internal/package-supply.js": 81,
  "packages/core/internal/plugin-storage.js": 87,
  "packages/mcp/lib/server.js": 87,
  "bin/internal/orchestrator-mcp-runtime.js": 68,
  "plugins/change-tracking/lib/attempt-service.js": 82,
});

/** Rejects missing critical files and branch regressions, including invalid metrics. */
export function coverageFailures(summary, floors = CRITICAL_BRANCH_FLOORS, root = ROOT) {
  if (!Array.isArray(summary?.files)) return ["Coverage summary is missing files"];
  const measured = new Map(summary.files.map((file) => [
    path.relative(root, file.path).split(path.sep).join("/"), file.coveredBranchPercent,
  ]));
  return Object.entries(floors).flatMap(([file, minimum]) => {
    const actual = measured.get(file);
    return Number.isFinite(actual) && actual >= minimum
      ? [] : [`${file}: branch coverage ${actual ?? "missing"}; required ${minimum}%`];
  });
}

/** Native Node reporter: preserve discovery and fail closed if coverage is absent. */
export default async function* coverageGate(source) {
  let measured = false;
  for await (const event of source) {
    if (event.type !== "test:coverage") continue;
    measured = true;
    const failures = coverageFailures(event.data.summary);
    const rows = Object.entries(CRITICAL_BRANCH_FLOORS).map(([file, minimum]) => {
      const item = event.data.summary?.files?.find((candidate) => (
        path.relative(ROOT, candidate.path).split(path.sep).join("/") === file
      ));
      return `| ${file} | ${item?.coveredBranchPercent?.toFixed(2) ?? "missing"}% | ${minimum}% |`;
    });
    const report = ["## Critical branch coverage", "", "| File | Actual | Minimum |",
      "| --- | --- | --- |", ...rows, "", ...failures, ""].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
    }
    if (failures.length) throw new Error(`COVERAGE_GATE_FAILED:\n${failures.join("\n")}`);
    yield "Critical coverage gate passed.\n";
  }
  if (!measured) throw new Error("COVERAGE_GATE_FAILED: no coverage event received");
}
