/** @fileoverview Fail CI on high/critical CodeQL findings without paid integrations. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Reads SARIF rules by ID (rule indices are optional) and rejects malformed reports. */
export function blockingFindings(report) {
  if (report?.version !== "2.1.0" || !Array.isArray(report.runs) || !report.runs.length) {
    throw new Error("SARIF_INVALID: expected SARIF 2.1.0 with analysis runs");
  }
  return report.runs.flatMap((run) => {
    if (run.invocations?.some((invocation) => invocation.executionSuccessful === false)) {
      throw new Error("SARIF_INVALID: analysis invocation failed");
    }
    if (!Array.isArray(run.results) || !Array.isArray(run.tool?.driver?.rules)) {
      throw new Error("SARIF_INVALID: missing results or rules");
    }
    const rules = new Map(run.tool.driver.rules.map((rule) => [rule.id, rule]));
    return run.results.flatMap((result) => {
      const rule = rules.get(result.ruleId) ?? run.tool.driver.rules[result.ruleIndex];
      if (!rule) throw new Error("SARIF_INVALID: result has no matching rule");
      const severity = Number(rule.properties?.["security-severity"] ?? 0);
      if (!Number.isFinite(severity)) throw new Error("SARIF_INVALID: invalid security severity");
      const level = result.level ?? rule.defaultConfiguration?.level;
      if (severity < 7 && level !== "error") return [];
      return [`${rule.id}: severity=${severity}, level=${level ?? "warning"}`];
    });
  });
}

/** Checks every analysis file; missing output must not produce a green check. */
async function main(directory) {
  if (!directory) throw new Error("Usage: node scripts/check-sarif.js <sarif-directory>");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sarif"));
  if (!files.length) throw new Error("SARIF_MISSING: no analysis files");
  const failures = [];
  for (const file of files) {
    failures.push(...blockingFindings(JSON.parse(await readFile(path.join(directory, file), "utf8"))));
  }
  if (failures.length) throw new Error(`SECURITY_GATE_FAILED:\n${failures.join("\n")}`);
  console.log(`Security gate passed (${files.length} SARIF reports).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv[2]);
}
