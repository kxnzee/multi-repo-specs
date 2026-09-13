/** @fileoverview Отпечаток реальных входов Apply, независимый от галочек и Verify. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { fingerprint } from "./records.js";
import { applyInstructions, requireOpenSpec11 } from "./openspec-compatibility.js";

/** Галочка отражает прогресс; остальной текст задания сравнивается полностью. */
function normalizeTasks(source) {
  return source.replace(/\r\n/gu, "\n").replace(/^(\s*[-*]\s*)\[[\sxX]\]/gmu, "$1[ ]");
}

/** Читает разрешённую OpenSpec схему и её входы, включая пользовательские apply.tracks. */
export async function planning(context, changeId, { committed = false } = {}) {
  await requireOpenSpec11(context.process);
  const instructions = await applyInstructions(context.process, changeId);
  const location = JSON.parse(await context.process.run("openspec", ["schema", "which", instructions.schemaName, "--json"]));
  if (typeof location.path !== "string" || !path.isAbsolute(location.path)) {
    throw new Error("TRACKING_PLAN_INVALID: OpenSpec не разрешил схему");
  }
  const schemaSource = await fs.readFile(path.join(location.path, "schema.yaml"), "utf8");
  const schema = parse(schemaSource);
  const tracks = schema.apply?.tracks;
  if (typeof tracks !== "string" || !tracks || !Array.isArray(schema.artifacts)) {
    throw new Error("TRACKING_PLAN_INVALID: схема должна объявлять apply.tracks");
  }
  const prefix = `openspec/changes/${changeId}/`;
  if (committed) {
    const storeRoot = path.resolve(instructions.changeDir, "../../..");
    const schemaPath = path.relative(storeRoot, path.join(location.path, "schema.yaml")).split(path.sep).join("/");
    if (!schemaPath.startsWith("../") && !path.isAbsolute(schemaPath)) {
      let historical;
      try { historical = await context.process.run("git", ["show", `HEAD:${schemaPath}`]); }
      catch { throw new Error(`TRACKING_PLAN_UNCOMMITTED: сохраните схему Apply в Git: ${schemaPath}`); }
      if (fingerprint(parse(historical)) !== fingerprint(schema)) {
        throw new Error(`TRACKING_PLAN_UNCOMMITTED: сохраните схему Apply в Git: ${schemaPath}`);
      }
    }
  }
  const relative = (absolute) => {
    const name = path.relative(instructions.changeDir, absolute).split(path.sep).join("/");
    if (!name || name.startsWith("../") || path.isAbsolute(name)) throw new Error("TRACKING_PLAN_INVALID: вход вне Change");
    return prefix + name;
  };
  const trackPath = relative(path.resolve(instructions.changeDir, tracks));
  const required = schema.apply.requires ?? schema.artifacts.map(({ id }) => id);
  if (!Array.isArray(required) || required.some((id) => typeof id !== "string")) {
    throw new Error("TRACKING_PLAN_INVALID: несовместимый apply.requires");
  }
  // Входы обязательных артефактов тоже задают план; последующий Verify не является его входом.
  const upstream = new Set(required);
  for (const id of upstream) {
    const artifact = schema.artifacts.find((item) => item.id === id);
    if (!artifact || !Array.isArray(artifact.requires ?? [])) throw new Error("TRACKING_PLAN_INVALID: неизвестный вход Apply");
    for (const dependency of artifact.requires ?? []) upstream.add(dependency);
  }
  const selected = new Set([trackPath]);
  for (const id of upstream) {
    for (const file of instructions.contextFiles[id] ?? []) selected.add(relative(file));
  }
  const inputs = [];
  for (const file of [...selected].sort()) {
    const source = await context.files.read(file);
    const normalized = file === trackPath ? normalizeTasks(source) : source.replace(/\r\n/gu, "\n");
    if (committed) {
      let historical;
      try { historical = await context.process.run("git", ["show", `HEAD:${file}`]); }
      catch { throw new Error(`TRACKING_PLAN_UNCOMMITTED: сохраните исходный план в Git: ${file}`); }
      // Process facade удаляет конечные переводы строк в stdout.
      const previous = file === trackPath ? normalizeTasks(historical) : historical.replace(/\r\n/gu, "\n");
      if (previous.trimEnd() !== normalized.trimEnd()) {
        throw new Error(`TRACKING_PLAN_UNCOMMITTED: сохраните исходный план в Git: ${file}`);
      }
    }
    inputs.push([file, normalized.trimEnd()]);
  }
  return { ...instructions, fingerprint: fingerprint([instructions.schemaName, schema, inputs]),
    sources: { task_file: trackPath, inputs: [...selected].sort() } };
}
