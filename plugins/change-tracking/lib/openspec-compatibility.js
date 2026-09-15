/** @fileoverview Минимальная проверка OpenSpec и списка Changes. */
import { identifier } from "./records.js";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/** Parses one OpenSpec JSON response. */
function parseJson(source, command) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} вернула некорректный JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} вернула несовместимый JSON`);
  }
  return value;
}

/** Requires the scoped process capability used by the integration. */
function requireProcess(process) {
  if (!process || typeof process.run !== "function") {
    throw new Error("OPENSPEC_11_REQUIRED: отсутствует scoped Process facade");
  }
  return process;
}

/** Requires the verified OpenSpec API range. */
export async function requireOpenSpec11(process) {
  const version = (await requireProcess(process).run("openspec", ["--version"])).trim();
  const match = VERSION.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (!match || major !== 1 || minor < 11) {
    throw new Error(
      `OPENSPEC_11_REQUIRED: Change Tracking требует OpenSpec >=1.11.0 <2; получена ${version}`,
    );
  }
  return version;
}

/** Список активных Changes принадлежит OpenSpec, а не локальной карте Tracking. */
export async function activeChanges(process) {
  await requireOpenSpec11(process);
  const value = parseJson(await process.run("openspec", ["list", "--json"]), "openspec list --json");
  if (!Array.isArray(value.changes) || value.changes.some((item) => !item || !identifier(item.name)) ||
    new Set(value.changes.map(({ name }) => name)).size !== value.changes.length) {
    throw new Error("OPENSPEC_STATUS_INVALID: list не содержит однозначный список Changes");
  }
  return value.changes.map(({ name }) => name).sort();
}
