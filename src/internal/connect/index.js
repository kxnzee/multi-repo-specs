/** @fileoverview Оркестрация подключения Store и multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveExecutionMode } from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { assertOpenSpecRoot, assertOpenSpecStore, runOpenSpecJson } from "../shared/openspec.js";
import { assertStoreDoctor, readStoreConfiguration } from "../shared/store.js";
import { rememberWorkspace, resolveWorkspace } from "../shared/workspace.js";
import { connectRepository } from "./repository.js";

/**
 * Подключает текущий компьютер к готовому Store и собирает workspace.
 *
 * @param {object} [options] Параметры подключения.
 * @param {string} [options.start] Корень Store.
 * @param {string} [options.workspace] Корень workspace.
 * @param {(message: string, status?: "running" | "success" | "info" | "warning" | "failure") => void} [options.onProgress] Пользовательский вывод прогресса.
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
  if (config.codeRepositories.length === 0) {
    throw new Error("CONFIG_INVALID: для пилота нужен минимум один repository с roles: [code]");
  }
  const executionMode = resolveExecutionMode(config.strict, noStrict);
  await inspectOpenSpecCli(commandRunner, storeRoot);
  const registration = await runOpenSpecJson(commandRunner, ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"], storeRoot);
  assertOpenSpecStore(registration.store, { path: storeRoot, storeId: metadata.id }, "openspec store register");
  const storeDoctor = await runOpenSpecJson(commandRunner, ["store", "doctor", metadata.id, "--json"], storeRoot);
  assertStoreDoctor(storeDoctor, metadata.id, storeRoot);
  const doctorOutput = await commandRunner("openspec", ["doctor", "--store", metadata.id], {
    cwd: storeRoot,
    environment: { NODE_NO_WARNINGS: "1" },
    onStderr: (message) => onProgress(`Предупреждение OpenSpec:\n${message}`, "warning"),
  });
  if (doctorOutput) onProgress(doctorOutput, "info");
  const context = await runOpenSpecJson(commandRunner, ["context", "--store", metadata.id, "--json"], storeRoot);
  assertOpenSpecRoot(context.root, { path: storeRoot, storeId: metadata.id, source: "store" }, `openspec context --store ${metadata.id} --json`);
  const workspace = await resolveWorkspace(
    storeRoot,
    metadata.id,
    requestedWorkspace,
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
      onProgress: (message, status) => onProgress(`${prefix}: ${message}`, status),
      commandRunner,
      executionMode,
    });
    repositories.push(connected);
    onProgress(`${prefix}: готово`, "success");
  }
  if (requestedWorkspace && executionMode === "strict") {
    await rememberWorkspace(storeRoot, workspace);
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
