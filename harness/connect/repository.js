/** @fileoverview Подключение и проверка одного Code Repository. */

import path from "node:path";
import { sameGitRemote } from "../config/index.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { isGitRevision } from "../shared/schema.js";
import { ensurePointer } from "./pointer.js";
import { pathState } from "./workspace.js";

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
  const gitRoot = path.resolve(commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }));
  if (gitRoot !== repositoryRoot) throw new Error(`${repository.id}: каталог не является корнем Git-репозитория`);
  const origin = commandRunner("git", ["remote", "get-url", "origin"], { cwd: repositoryRoot });
  if (!sameGitRemote(origin, repository.url)) throw new Error(`${repository.id}: origin не совпадает с sdd.yaml`);
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
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner Исполнитель команд.
 * @returns {Promise<import("../shared/types.js").ConnectedRepository>} Проверенное состояние подключения.
 */
export async function connectRepository({ repository, sourceRoot, storeId, storeRoot, commandRunner }) {
  const repositoryRoot = path.join(sourceRoot, repository.id);
  const existing = await pathState(repositoryRoot);
  let cloned = false;
  if (!existing) {
    commandRunner("git", ["clone", "--single-branch", "--no-tags", "--branch", repository.defaultBranch, "--", repository.url, repositoryRoot], {
      cwd: sourceRoot,
      sensitiveValues: [repository.url],
    });
    cloned = true;
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
  }
  const git = inspectCheckout(repositoryRoot, repository, commandRunner);
  const pointerCreated = await ensurePointer(repositoryRoot, storeId);
  const pointerPending = Boolean(commandRunner("git", ["status", "--porcelain", "--untracked-files=all", "--", GIT_POINTER_PATH], { cwd: repositoryRoot }));
  const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], repositoryRoot);
  assertOpenSpecRoot(doctor.root, { path: storeRoot, storeId, source: "declared" }, "openspec doctor --json");
  if (doctor.root.healthy !== true) throw new Error(`${repository.id}: openspec doctor не подтвердила исправный Store`);
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
