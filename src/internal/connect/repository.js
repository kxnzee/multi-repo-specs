/** @fileoverview Подключение и проверка одного Code Repository. */

import path from "node:path";
import { lstatOrNull } from "../shared/files.js";
import { inspectRepositoryIdentity } from "../shared/git.js";
import { createGitClient } from "../shared/git-client.js";
import { assertOpenSpecRoot, reportOpenSpecDiagnostic, runOpenSpecJson } from "../shared/openspec.js";
import { ensurePointer, POINTER_PATH } from "../shared/pointer.js";
import { isGitRevision } from "../shared/schema.js";

/**
 * Проверяет существующий checkout без fetch/pull.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {{id: string, remote: string, defaultBranch: string}} repository Конфигурация репозитория.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<{branch: string, revision: string}>} Проверенное Git-состояние.
 */
async function inspectCheckout(repositoryRoot, repository, commandRunner) {
  await inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const git = createGitClient(repositoryRoot, commandRunner);
  const branch = await git.currentBranch();
  if (branch !== repository.defaultBranch) throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  const changedPaths = await git.statusPaths();
  if (changedPaths.some((filePath) => filePath !== POINTER_PATH)) {
    throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  }
  const revision = await git.revision();
  if (!isGitRevision(revision)) {
    throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
  }
  return { branch, revision };
}

/**
 * Клонирует отсутствующий Code Repository или валидирует существующий.
 *
 * @param {object} options Параметры подключения.
 * @param {{id: string, remote: string, defaultBranch: string}} options.repository Репозиторий.
 * @param {string} options.sourceRoot Каталог `<workspace>/src`.
 * @param {string} options.storeId ID центрального Store.
 * @param {string} options.storeRoot Абсолютный путь Store.
 * @param {(message: string, status?: "running" | "success" | "info" | "warning" | "failure") => void} options.onProgress Пользовательский вывод прогресса.
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner Исполнитель команд.
 * @param {"strict" | "relaxed"} options.executionMode Режим Git-гарантий.
 * @returns {Promise<import("../shared/types.js").ConnectedRepository>} Проверенное состояние подключения.
 */
export async function connectRepository({
  repository,
  sourceRoot,
  storeId,
  storeRoot,
  onProgress,
  commandRunner,
  executionMode,
}) {
  const repositoryRoot = path.join(sourceRoot, repository.id);
  const existing = await lstatOrNull(repositoryRoot);
  let cloned = false;
  if (!existing) {
    if (executionMode === "relaxed") {
      throw new Error(
        `${repository.id}: relaxed mode требует существующий локальный каталог ${repositoryRoot}`,
      );
    }
    onProgress("клонирование...");
    await createGitClient(sourceRoot, commandRunner).cloneBranch({
      url: repository.remote,
      target: repositoryRoot,
      branch: repository.defaultBranch,
    });
    cloned = true;
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
  } else {
    onProgress("проверка существующего checkout...");
  }
  const git = executionMode === "strict"
    ? await inspectCheckout(repositoryRoot, repository, commandRunner)
    : { branch: "unpinned", revision: "unpinned" };
  const pointerCreated = await ensurePointer(repositoryRoot, storeId);
  const pointerPending = executionMode === "strict" &&
    !(await createGitClient(repositoryRoot, commandRunner).isClean([POINTER_PATH]));
  onProgress("проверка OpenSpec pointer...");
  const doctorOutput = await commandRunner("openspec", ["doctor"], {
    cwd: repositoryRoot,
    environment: { NODE_NO_WARNINGS: "1" },
    onStderr: (message) => reportOpenSpecDiagnostic(onProgress, message),
  });
  if (doctorOutput) onProgress(doctorOutput, "info");
  const context = await runOpenSpecJson(commandRunner, ["context", "--json"], repositoryRoot);
  assertOpenSpecRoot(context.root, { path: storeRoot, storeId, source: "declared" }, "openspec context --json");
  return {
    id: repository.id,
    path: repositoryRoot,
    branch: git.branch,
    revision: git.revision,
    cloned,
    pointerCreated,
    pointerPending,
    status: pointerPending ? "needs_setup_pr" : "ready",
  };
}
