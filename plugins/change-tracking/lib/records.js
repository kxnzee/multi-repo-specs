/** @fileoverview Единая переносимая запись и локальный курсор работы. */
import { createHash } from "node:crypto";
import path from "node:path";

export const MAP_FILE = "implementation-map.yaml";
export const identifier = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
export const revision = (value) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
export const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
// SHA-256 используется для внутреннего сравнения снимков, не для ручного ввода.
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** Точный набор полей сохраняет отказ при несовместимом формате. */
export function shape(value, required, optional = []) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

/** Отпечаток снимка используется только внутри плагина для проверки свежести. */
export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Репозиторий и задача идентифицируют текущую запись внутри Change. */
export function recordKey(value) {
  return JSON.stringify([value.repository_id, value.task_id]);
}

/** Нормализует порядок полей для повторов и сравнения прочитанной версии. */
export function checkedRecord(value) {
  if (!shape(value, ["repository_id", "task_id", "planning_revision", "planning_fingerprint",
    "base_revision", "implementation_revision", "state"], ["note"]) ||
    !identifier(value.repository_id) || !nonempty(value.task_id) ||
    !revision(value.planning_revision) || !digest(value.planning_fingerprint) ||
    !revision(value.base_revision) || !revision(value.implementation_revision) ||
    !["partial", "complete"].includes(value.state) ||
    (value.note !== undefined && (value.state !== "partial" || !nonempty(value.note)))) {
    throw new Error("TRACKING_MAP_INVALID: несовместимая запись реализации; автоматическое преобразование не выполняется");
  }
  return { repository_id: value.repository_id, task_id: value.task_id,
    planning_revision: value.planning_revision, planning_fingerprint: value.planning_fingerprint,
    base_revision: value.base_revision, implementation_revision: value.implementation_revision,
    state: value.state, ...(value.note ? { note: value.note } : {}) };
}

/** Читает локальные курсоры, не превращая повреждённое состояние в пустое. */
export function localState(value) {
  if (value === null) return { contract_version: 1, sessions: [] };
  if (!shape(value, ["contract_version", "sessions"]) || value.contract_version !== 1 ||
    !Array.isArray(value.sessions)) throw new Error("TRACKING_STORAGE_INVALID: повреждено локальное состояние");
  for (const session of value.sessions) {
    if (!shape(session, ["change_id", "repository_id", "task_id", "checkout_path", "planning_revision",
      "planning_fingerprint", "base_revision", "observed", "last_saved", "active"]) ||
      !identifier(session.change_id) || !identifier(session.repository_id) || !nonempty(session.task_id) ||
      !nonempty(session.checkout_path) || !path.isAbsolute(session.checkout_path) ||
      !revision(session.planning_revision) || !revision(session.base_revision) ||
      !digest(session.planning_fingerprint) || typeof session.active !== "boolean" ||
      ![session.observed, session.last_saved].every((item) => item === null || digest(item))) {
      throw new Error("TRACKING_STORAGE_INVALID: повреждён курсор работы");
    }
  }
  const keys = value.sessions.map((item) => JSON.stringify([item.change_id, recordKey(item), item.checkout_path]));
  if (new Set(keys).size !== keys.length) throw new Error("TRACKING_STORAGE_INVALID: повторяющийся курсор");
  return value;
}
