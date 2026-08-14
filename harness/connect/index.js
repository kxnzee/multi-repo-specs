/** @fileoverview Оркестрация подключения Store и multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  assertSupportedOpenSpecVersion,
  parseOrchestratorConfig,
  parseStoreMetadata,
  sameGitRemote,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { connectRepository } from "./repository.js";
import { pathState, rememberWorkspace, resolveWorkspace } from "./workspace.js";

const REQUIRED_AGENT_COMMANDS = Object.freeze([
  "opsx-explore.md",
  "opsx-continue.md",
  "opsx-update.md",
  "sdd-context.md",
  "sdd-change.md",
  "sdd-apply.md",
]);
const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  exploreInstructions: path.join(".sdd", "instructions", "explore.md"),
  orchestratorConfig: "openspec-orch.yaml",
});

/**
 * Читает обязательный обычный файл внутри заданного корня.
 *
 * @param {string} root Абсолютный корень проекта.
 * @param {string} relativePath Относительный путь файла.
 * @returns {Promise<string>} UTF-8 содержимое.
 */
async function readFile(root, relativePath) {
  const target = path.join(root, relativePath);
  const stat = await pathState(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Отсутствует обычный файл ${relativePath}`);
  return fs.readFile(target, "utf8");
}

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
 * Проверяет результат `openspec store doctor`.
 *
 * @param {import("../shared/types.js").OpenSpecResponse} payload Ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} storeRoot Ожидаемый путь.
 * @returns {void}
 */
function validateStoreDoctor(payload, storeId, storeRoot) {
  const stores = Array.isArray(payload.stores) ? payload.stores.filter(({ id }) => id === storeId) : [];
  if (stores.length !== 1) throw new Error(`openspec store doctor не вернула ровно один Store ${storeId}`);
  const store = stores[0];
  if (path.resolve(store.root ?? "") !== storeRoot) {
    throw new Error(`openspec store doctor вернула другой путь Store: ${store.root ?? "не указан"}`);
  }
  if (store.metadata?.present !== true || store.metadata?.valid !== true) {
    throw new Error("openspec store doctor не подтвердила валидную Store metadata");
  }
  if (store.metadata.id !== undefined && store.metadata.id !== storeId) {
    throw new Error(`openspec store doctor вернула другой Store ID: ${store.metadata.id}`);
  }
  if (store.openspec_root?.healthy !== true) {
    throw new Error("openspec store doctor не подтвердила исправный OpenSpec root");
  }
}

/**
 * Подключает текущий компьютер к готовому Store и собирает workspace.
 *
 * @param {object} [options] Параметры подключения.
 * @param {string} [options.start] Корень Store.
 * @param {string} [options.workspace] Корень workspace.
 * @param {(message: string) => void} [options.onProgress] Пользовательский вывод прогресса.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд.
 * @returns {Promise<import("../shared/types.js").ConnectResult>} Проверенное состояние workspace.
 */
export async function connectProject({
  start = process.cwd(),
  workspace: requestedWorkspace,
  onProgress = () => {},
  commandRunner = runCommand,
} = {}) {
  onProgress("Проверка Store и OpenSpec...");
  const storeRoot = await fs.realpath(path.resolve(start));
  const metadata = parseStoreMetadata(await readFile(storeRoot, PATHS.metadata));
  const config = parseOrchestratorConfig(await readFile(storeRoot, PATHS.orchestratorConfig));
  await readFile(storeRoot, PATHS.exploreInstructions);
  await readFile(storeRoot, config.agent.instructionsFile);
  if (config.storeRepository.id !== metadata.id) throw new Error("Store ID в openspec-orch.yaml не совпадает с Store metadata");
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  assertSupportedOpenSpecVersion(config.openSpecVersion);
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: storeRoot });
  if (installedVersion !== config.openSpecVersion) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${config.openSpecVersion}`);
  }
  for (const command of REQUIRED_AGENT_COMMANDS) {
    await readFile(storeRoot, path.join(config.agent.commandsDirectory, command));
  }
  for (const subagent of config.agent.requiredSubagents) {
    await readFile(storeRoot, path.join(config.agent.agentsDirectory, subagent));
  }
  const registration = runOpenSpecJson(commandRunner, ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"], storeRoot);
  assertStoreIdentity(registration, metadata.id, storeRoot, "openspec store register");
  const storeDoctor = runOpenSpecJson(commandRunner, ["store", "doctor", metadata.id, "--json"], storeRoot);
  validateStoreDoctor(storeDoctor, metadata.id, storeRoot);
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
    });
    repositories.push(connected);
    onProgress(`${prefix}: готово`);
  }
  if (requestedWorkspace) rememberWorkspace(storeRoot, workspace, commandRunner);
  return {
    storeId: metadata.id,
    storeRoot,
    workspace,
    status: repositories.some(({ pointerPending }) => pointerPending) ? "needs_setup_pr" : "ready",
    repositories,
  };
}
