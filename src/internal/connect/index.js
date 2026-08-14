/** @fileoverview Оркестрация подключения Store и multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveExecutionMode } from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { assertStoreDoctor, readStoreConfiguration } from "../shared/store.js";
import { rememberWorkspace, resolveWorkspace } from "../shared/workspace.js";
import { connectRepository } from "./repository.js";

/**
 * Проверяет Store ID и путь в ответе OpenSpec.
 *
 * @param {import("../shared/types.js").OpenSpecResponse} payload Ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} storeRoot Ожидаемый путь.
 * @param {string} command Команда для ошибки.
 * @returns {void}
 */
function assertStoreIdentity(payload, storeId, storeRoot, command) {
  if (payload.store?.id !== storeId || path.resolve(payload.store?.root ?? "") !== storeRoot) {
    throw new Error(`${command} вернула другой Store`);
  }
}

/**
 * Подключает текущий компьютер к готовому Store и собирает workspace.
 *
 * @param {object} [options] Параметры подключения.
 * @param {string} [options.start] Корень Store.
 * @param {string} [options.workspace] Корень workspace.
 * @param {(message: string) => void} [options.onProgress] Пользовательский вывод прогресса.
 * @param {boolean} [options.noStrict] Отключить Git-гарантии для текущего вызова.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд.
 * @returns {Promise<import("../shared/types.js").ConnectResult>} Проверенное состояние workspace.
 */
export async function connectProject({
  start = process.cwd(),
  workspace: requestedWorkspace,
  onProgress = () => {},
  noStrict = false,
  commandRunner = runCommand,
} = {}) {
  onProgress("Проверка Store и OpenSpec...");
  const storeRoot = await fs.realpath(path.resolve(start));
  const { metadata, config } = await readStoreConfiguration(storeRoot);
  const executionMode = resolveExecutionMode(config.strict, noStrict);
  inspectOpenSpecCli(commandRunner, storeRoot);
  const registration = runOpenSpecJson(commandRunner, ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"], storeRoot);
  assertStoreIdentity(registration, metadata.id, storeRoot, "openspec store register");
  const storeDoctor = runOpenSpecJson(commandRunner, ["store", "doctor", metadata.id, "--json"], storeRoot);
  assertStoreDoctor(storeDoctor, metadata.id, storeRoot);
  const doctorOutput = commandRunner("openspec", ["doctor", "--store", metadata.id], {
    cwd: storeRoot,
    environment: { NODE_NO_WARNINGS: "1" },
    onStderr: (message) => onProgress(`Предупреждение OpenSpec:\n${message}`),
  });
  if (doctorOutput) onProgress(doctorOutput);
  const context = runOpenSpecJson(commandRunner, ["context", "--store", metadata.id, "--json"], storeRoot);
  assertOpenSpecRoot(context.root, { path: storeRoot, storeId: metadata.id, source: "store" }, `openspec context --store ${metadata.id} --json`);
  const workspace = await resolveWorkspace(
    storeRoot,
    metadata.id,
    requestedWorkspace,
    commandRunner,
    executionMode === "strict",
  );
  const sourceRoot = path.join(workspace, "src");
  await fs.mkdir(sourceRoot, { recursive: true });
  const repositories = [];
  for (const [index, repository] of config.codeRepositories.entries()) {
    const prefix = `[${index + 1}/${config.codeRepositories.length}] ${repository.id}`;
    const connected = await connectRepository({
      repository,
      sourceRoot,
      storeId: metadata.id,
      storeRoot,
      onProgress: (message) => onProgress(`${prefix}: ${message}`),
      commandRunner,
      executionMode,
    });
    repositories.push(connected);
    onProgress(`${prefix}: готово`);
  }
  if (requestedWorkspace && executionMode === "strict") {
    rememberWorkspace(storeRoot, workspace, commandRunner);
  }
  return {
    storeId: metadata.id,
    storeRoot,
    workspace,
    executionMode,
    status: repositories.some(({ pointerPending }) => pointerPending) ? "needs_setup_pr" : "ready",
    repositories,
  };
}
