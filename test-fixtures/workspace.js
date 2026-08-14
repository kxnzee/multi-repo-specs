/** @fileoverview Общая filesystem/Git-инфраструктура интеграционных тестов. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "../src/internal/shared/command.js";

/**
 * Создаёт канонический временный каталог и регистрирует его удаление.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @param {string} prefix Уникальный префикс сценария.
 * @returns {Promise<string>} Канонический путь.
 */
export async function temporaryDirectory(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Записывает дерево обычных UTF-8 файлов относительно root.
 *
 * @param {string} root Корень назначения.
 * @param {Record<string, string>} files Относительные пути и содержимое.
 * @returns {Promise<void>}
 */
export async function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
}

/**
 * Настраивает локальную Git identity для тестовых коммитов.
 *
 * @param {string} repository Git checkout.
 * @returns {Promise<void>}
 */
export async function configureGit(repository) {
  await runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  await runCommand("git", ["-C", repository, "config", "user.name", "OpenSpec Orchestrator Tests"]);
}

/**
 * Создаёт Git-репозиторий с веткой main и тестовой identity.
 *
 * @param {string} repository Путь будущего checkout.
 * @returns {Promise<void>}
 */
export async function initializeGitRepository(repository) {
  await runCommand("git", ["init", "--initial-branch", "main", repository]);
  await configureGit(repository);
}

/**
 * Записывает файлы и создаёт один тестовый commit.
 *
 * @param {string} repository Git checkout.
 * @param {Record<string, string>} files Начальные файлы.
 * @param {{message?: string, allowEmpty?: boolean}} [options] Параметры commit.
 * @returns {Promise<void>}
 */
export async function commitFiles(
  repository,
  files,
  { message = "initial", allowEmpty = false } = {},
) {
  await writeFiles(repository, files);
  await runCommand("git", ["-C", repository, "add", "."]);
  await runCommand("git", [
    "-C",
    repository,
    "commit",
    ...(allowEmpty ? ["--allow-empty"] : []),
    "-m",
    message,
  ]);
}

/**
 * Создаёт source checkout и соответствующий bare remote.
 *
 * @param {string} root Корень сценария.
 * @param {string} name Базовое имя репозитория.
 * @param {Record<string, string>} [files] Начальные файлы.
 * @returns {Promise<string>} Путь bare remote.
 */
export async function createBareRemote(root, name, files = {}) {
  const source = path.join(root, `${name}-source`);
  const remote = path.join(root, `${name}.git`);
  await initializeGitRepository(source);
  await commitFiles(source, files, { allowEmpty: true });
  await runCommand("git", ["clone", "--bare", source, remote]);
  return remote;
}

/**
 * Создаёт checkout с initial commit, bare remote и настроенным origin.
 *
 * @param {string} root Корень сценария.
 * @param {string} relativePath Относительный путь checkout.
 * @param {string} remoteName Имя bare remote.
 * @param {Record<string, string>} files Начальные файлы.
 * @returns {Promise<{checkout: string, remote: string}>} Канонический checkout и remote.
 */
export async function createCheckoutWithRemote(root, relativePath, remoteName, files) {
  const checkout = path.join(root, relativePath);
  const remote = path.join(root, `${remoteName}.git`);
  await fs.mkdir(path.dirname(checkout), { recursive: true });
  await initializeGitRepository(checkout);
  await commitFiles(checkout, files);
  await runCommand("git", ["clone", "--bare", checkout, remote]);
  await runCommand("git", ["-C", checkout, "remote", "add", "origin", remote]);
  return { checkout: await fs.realpath(checkout), remote };
}
