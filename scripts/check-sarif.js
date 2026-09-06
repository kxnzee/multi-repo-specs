/** @fileoverview Fail CI on high/critical CodeQL findings without paid integrations. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Resolves SARIF 2.1.0 rule references within the driver or a CodeQL query pack. */
function resultRule(tool, result) {
  const reference = result.rule ?? {};
  const componentReference = reference.toolComponent ?? {};
  let component = tool.driver;
  if (componentReference.index !== undefined) {
    if (!Number.isInteger(componentReference.index) || componentReference.index < 0) {
      throw new Error("SARIF_INVALID: invalid tool component index");
    }
    component = tool.extensions?.[componentReference.index];
  } else if (componentReference.guid !== undefined) {
    component = [tool.driver, ...(tool.extensions ?? [])].find((item) => (
      item.guid === componentReference.guid
    ));
  }
  if (!component || !Array.isArray(component.rules)) {
    throw new Error("SARIF_INVALID: result has no matching rule component");
  }
  const id = reference.id ?? result.ruleId;
  const index = reference.index ?? result.ruleIndex;
  if ((reference.id !== undefined && result.ruleId !== undefined && reference.id !== result.ruleId)
    || (reference.index !== undefined && result.ruleIndex !== undefined && reference.index !== result.ruleIndex)) {
    throw new Error("SARIF_INVALID: conflicting rule references");
  }
  const rule = index !== undefined
    ? (Number.isInteger(index) && index >= 0 ? component.rules[index] : undefined)
    : component.rules.find((item) => (id !== undefined ? item.id === id : (
      reference.guid !== undefined && item.guid === reference.guid
    )));
  if (!rule || (id !== undefined && rule.id !== id)
    || (reference.guid !== undefined && rule.guid !== reference.guid)) {
    throw new Error("SARIF_INVALID: result has no matching rule");
  }
  return rule;
}

/** Reads driver/query-pack rules and rejects malformed or unsuccessful reports. */
export function blockingFindings(report) {
  if (report?.version !== "2.1.0" || !Array.isArray(report.runs) || !report.runs.length) {
    throw new Error("SARIF_INVALID: expected SARIF 2.1.0 with analysis runs");
  }
  return report.runs.flatMap((run) => {
    if (run.invocations?.some((invocation) => invocation.executionSuccessful === false)) {
      throw new Error("SARIF_INVALID: analysis invocation failed");
    }
    if (!Array.isArray(run.results) || !run.tool?.driver) {
      throw new Error("SARIF_INVALID: missing results or rules");
    }
    return run.results.flatMap((result) => {
      const rule = resultRule(run.tool, result);
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
