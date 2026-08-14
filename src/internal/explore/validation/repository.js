/** @fileoverview Проверки Code Repositories и их OpenSpec pointers для Explore. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { lstatOrNull } from "../../shared/files.js";
import { inspectRepositoryIdentity } from "../../shared/git.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../../shared/openspec.js";
import { POINTER_PATH, readPointer } from "../../shared/pointer.js";

/**
 * Разрешает пути всех зарегистрированных Code Repositories в workspace.
 *
 * @param {string} workspace Абсолютный путь multi-repo workspace.
 * @param {import("../../shared/types.js").RegisteredRepository[]} repositories Записи `role: code`.
 * @param {typeof import("../../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @param {"strict" | "relaxed"} [executionMode] Режим Git identity.
 * @returns {Promise<import("../../shared/types.js").ResolvedRepository[]>} Канонические checkout.
 */
export async function resolveCodeRepositories(
  workspace,
  repositories,
  commandRunner,
  executionMode = "strict",
) {
  const sourceRoot = path.join(workspace, "src");
  const resolved = [];
  for (const repository of repositories) {
    const repositoryRoot = path.join(sourceRoot, repository.id);
    const stat = await lstatOrNull(repositoryRoot);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${repository.id}: отсутствует checkout ${repositoryRoot}; выполните openspec-orch connect`);
    }
    const canonicalRoot = await fs.realpath(repositoryRoot);
    if (executionMode === "strict") {
      inspectRepositoryIdentity(canonicalRoot, repository, commandRunner);
    }
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
    if (await lstatOrNull(path.join(repository.path, "openspec", directory))) {
      throw new Error(
        `${repository.id}: локальный openspec/${directory} запрещён в Code Repository`,
      );
    }
  }
  const pointerPath = path.join(repository.path, POINTER_PATH);
  const pointerStat = await lstatOrNull(pointerPath);
  if (!pointerStat?.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${repository.id}: отсутствует принятый OpenSpec pointer; выполните openspec-orch connect`);
  }
  if (await readPointer(repository.path) !== storeId) {
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
    throw new Error("OpenSpec Orchestrator получил некорректный результат выбора репозиториев");
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
