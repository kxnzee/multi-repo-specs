/** @fileoverview Подключение и проверка одного Code Repository. */

import path from "node:path";
import { lstatOrNull } from "../shared/files.js";
import { inspectRepositoryIdentity } from "../shared/git.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { isGitRevision } from "../shared/schema.js";
import { ensurePointer } from "./pointer.js";

const GIT_POINTER_PATH = "openspec/config.yaml";

/**
 * Проверяет существующий checkout без fetch/pull.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {{id: string, url: string, defaultBranch: string}} repository Конфигурация репозитория.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {{branch: string, revision: string}} Проверенное Git-состояние.
 */
function inspectCheckout(repositoryRoot, repository, commandRunner) {
  inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const branch = commandRunner("git", ["branch", "--show-current"], { cwd: repositoryRoot });
  if (branch !== repository.defaultBranch) throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  const changes = commandRunner("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repositoryRoot })
    .split(/\r?\n/)
    .filter(Boolean);
  if (changes.some((line) => line.slice(3) !== GIT_POINTER_PATH)) {
    throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  }
  const revision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  if (!isGitRevision(revision)) {
    throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
  }
  return { branch, revision };
}

/**
 * Клонирует отсутствующий Code Repository или валидирует существующий.
 *
 * @param {object} options Параметры подключения.
 * @param {{id: string, url: string, defaultBranch: string}} options.repository Репозиторий.
 * @param {string} options.sourceRoot Каталог `<workspace>/src`.
 * @param {string} options.storeId ID центрального Store.
 * @param {string} options.storeRoot Абсолютный путь Store.
 * @param {(message: string) => void} options.onProgress Пользовательский вывод прогресса.
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
    commandRunner("git", ["clone", "--single-branch", "--no-tags", "--branch", repository.defaultBranch, "--", repository.url, repositoryRoot], {
      cwd: sourceRoot,
      sensitiveValues: [repository.url],
    });
    cloned = true;
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
  } else {
    onProgress("проверка существующего checkout...");
  }
  const git = executionMode === "strict"
    ? inspectCheckout(repositoryRoot, repository, commandRunner)
    : { branch: "unpinned", revision: "unpinned" };
  const pointerCreated = await ensurePointer(repositoryRoot, storeId);
  const pointerPending = executionMode === "strict" && Boolean(commandRunner(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", GIT_POINTER_PATH],
    { cwd: repositoryRoot },
  ));
  onProgress("проверка OpenSpec pointer...");
  const doctorOutput = commandRunner("openspec", ["doctor"], {
    cwd: repositoryRoot,
    environment: { NODE_NO_WARNINGS: "1" },
    onStderr: (message) => onProgress(`Предупреждение OpenSpec:\n${message}`),
  });
  if (doctorOutput) onProgress(doctorOutput);
  const context = runOpenSpecJson(commandRunner, ["context", "--json"], repositoryRoot);
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
