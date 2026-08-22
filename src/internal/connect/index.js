/** @fileoverview Оркестрация подключения Store и multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveExecutionMode } from "../config/index.js";
import { PROJECT_SETTINGS } from "../config/settings.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { createOpenSpecClient } from "../shared/openspec-client.js";
import {
  assertOpenSpecRoot,
  assertOpenSpecStore,
  parseOpenSpecJson,
  reportOpenSpecDiagnostic,
} from "../shared/openspec-model.js";
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
  const { metadata, project } = await readStoreConfiguration(storeRoot);
  if (project.codeRepositories.length === 0) {
    throw new Error("CONFIG_INVALID: для пилота нужен минимум один repository с roles: [code]");
  }
  const executionMode = resolveExecutionMode(project.strict, noStrict);
  await inspectOpenSpecCli(commandRunner, storeRoot);
  const openSpec = createOpenSpecClient(storeRoot, commandRunner);
  const registrationArgs = ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"];
  const registration = parseOpenSpecJson(
    await openSpec.execute(registrationArgs),
    `openspec ${registrationArgs.join(" ")}`,
  );
  assertOpenSpecStore(registration.store, { path: storeRoot, storeId: metadata.id }, "openspec store register");
  const storeDoctorArgs = ["store", "doctor", metadata.id, "--json"];
  const storeDoctor = parseOpenSpecJson(
    await openSpec.execute(storeDoctorArgs),
    `openspec ${storeDoctorArgs.join(" ")}`,
  );
  assertStoreDoctor(storeDoctor, metadata.id, storeRoot);
  const doctorOutput = await openSpec.execute(["doctor", "--store", metadata.id], {
    environment: { NODE_NO_WARNINGS: "1" },
    onStderr: (message) => reportOpenSpecDiagnostic(onProgress, message),
  });
  if (doctorOutput) onProgress(doctorOutput, "info");
  const contextArgs = ["context", "--store", metadata.id, "--json"];
  const contextCommand = `openspec ${contextArgs.join(" ")}`;
  const context = parseOpenSpecJson(await openSpec.execute(contextArgs), contextCommand);
  assertOpenSpecRoot(
    context.root,
    { path: storeRoot, storeId: metadata.id, source: "store" },
    contextCommand,
  );
  const workspace = await resolveWorkspace(
    storeRoot,
    metadata.id,
    requestedWorkspace,
    executionMode === "strict",
  );
  const sourceRoot = path.join(workspace, PROJECT_SETTINGS.workspace.repositoriesDirectory);
  await fs.mkdir(sourceRoot, { recursive: true });
  const repositories = [];
  for (const [index, repository] of project.codeRepositories.entries()) {
    const prefix = `[${index + 1}/${project.codeRepositories.length}] ${repository.id}`;
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
