/** @fileoverview Read-only проверка OpenSpec, Changes и task progress. */
import { identifier, nonempty } from "./records.js";

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

/** Читает task progress только через публичный JSON API OpenSpec. */
export async function taskProgress(process, changeId) {
  await requireOpenSpec11(process);
  const command = "openspec instructions apply --json";
  const value = parseJson(await process.run("openspec",
    ["instructions", "apply", "--change", changeId, "--json"]), command);
  if (value.changeName !== changeId || !Array.isArray(value.tasks) ||
    value.tasks.some((task) => !task || !nonempty(task.id) || !nonempty(task.description) ||
      typeof task.done !== "boolean") ||
    new Set(value.tasks.map(({ id }) => id)).size !== value.tasks.length) {
    throw new Error("OPENSPEC_STATUS_INVALID: instructions apply не содержит однозначный список задач");
  }
  const completed = value.tasks.filter(({ done }) => done).length;
  if (!value.progress || value.progress.total !== value.tasks.length ||
    value.progress.complete !== completed || value.progress.remaining !== value.tasks.length - completed) {
    throw new Error("OPENSPEC_STATUS_INVALID: instructions apply содержит противоречивый progress");
  }
  return { total_tasks: value.tasks.length, completed_tasks: completed,
    remaining_tasks: value.tasks.length - completed,
    tasks: value.tasks.map(({ id, description, done }) => ({ task_id: id, description, done })) };
}
