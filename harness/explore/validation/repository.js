/** @fileoverview Проверки Code Repositories и их OpenSpec pointers для Explore. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { assertOpenSpecRoot, runOpenSpecJson } from "../../shared/openspec.js";
import { inspectRepositoryIdentity } from "./git.js";

const OPEN_SPEC_CONFIG = path.join("openspec", "config.yaml");

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние либо `null`.
 */
async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Разрешает пути всех зарегистрированных Code Repositories в workspace.
 *
 * @param {string} workspace Абсолютный путь multi-repo workspace.
 * @param {import("../../shared/types.js").RegisteredRepository[]} repositories Записи `role: code`.
 * @param {typeof import("../../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<import("../../shared/types.js").ResolvedRepository[]>} Канонические checkout.
 */
export async function resolveCodeRepositories(workspace, repositories, commandRunner) {
  const sourceRoot = path.join(workspace, "src");
  const resolved = [];
  for (const repository of repositories) {
    const repositoryRoot = path.join(sourceRoot, repository.id);
    const stat = await pathState(repositoryRoot);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${repository.id}: отсутствует checkout ${repositoryRoot}; выполните sdd connect`);
    }
    const canonicalRoot = await fs.realpath(repositoryRoot);
    inspectRepositoryIdentity(canonicalRoot, repository, commandRunner);
    resolved.push({ ...repository, path: canonicalRoot });
  }
  return resolved;
}

/**
 * Проверяет config-only pointer Code Repository на тот же центральный Store.
 *
 * @param {import("../../shared/types.js").ResolvedRepository} repository Проверяемый репозиторий.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @param {typeof import("../../shared/command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Promise<void>}
 */
export async function validatePointer(repository, storeId, projectRoot, commandRunner) {
  for (const directory of ["specs", "changes"]) {
    if (await pathState(path.join(repository.path, "openspec", directory))) {
      throw new Error(
        `${repository.id}: локальный openspec/${directory} запрещён в Code Repository`,
      );
    }
  }
  const pointerPath = path.join(repository.path, OPEN_SPEC_CONFIG);
  const pointerStat = await pathState(pointerPath);
  if (!pointerStat?.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${repository.id}: отсутствует принятый OpenSpec pointer; выполните sdd connect`);
  }
  const pointer = (await fs.readFile(pointerPath, "utf8")).replaceAll("\r\n", "\n");
  if (pointer !== `store: ${storeId}\n`) {
    throw new Error(`${repository.id}: openspec/config.yaml должен содержать только store: ${storeId}`);
  }

  const doctorCommand = "openspec doctor --json";
  const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], repository.path);
  assertOpenSpecRoot(
    doctor.root,
    { path: projectRoot, storeId, source: "declared" },
    doctorCommand,
  );
  if (doctor.root.healthy !== true) {
    throw new Error(`${repository.id}: OpenSpec root не прошёл doctor`);
  }

  const context = runOpenSpecJson(commandRunner, ["context", "--json"], repository.path);
  assertOpenSpecRoot(
    context.root,
    { path: projectRoot, storeId, source: "declared" },
    "openspec context --json",
  );
}

/**
 * Проверяет результат интерактивного выбора и восстанавливает объекты репозиториев.
 *
 * @param {import("../../shared/types.js").ResolvedRepository[]} available Доступные репозитории.
 * @param {unknown} selectedIds Результат интерактивного selector.
 * @returns {import("../../shared/types.js").ResolvedRepository[]} Выбранные репозитории.
 */
export function validateSelection(available, selectedIds) {
  if (!Array.isArray(selectedIds)) {
    throw new Error("Интерактивный выбор репозиториев вернул некорректный результат");
  }
  const byId = new Map(available.map((repository) => [repository.id, repository]));
  const selected = [];
  const seen = new Set();
  for (const id of selectedIds) {
    if (typeof id !== "string" || !byId.has(id)) {
      throw new Error(`Выбран неизвестный Code Repository: ${String(id)}`);
    }
    if (seen.has(id)) throw new Error(`Code Repository выбран повторно: ${id}`);
    seen.add(id);
    selected.push(byId.get(id));
  }
  return selected;
}
