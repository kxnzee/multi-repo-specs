/** @fileoverview Чтение и общие проверки Store перед рабочими командами OpenSpec Orchestrator. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import * as z from "zod";

import { SERVICE_PATHS } from "../config/constants.js";
import { parseOrchestratorConfig, parseStoreMetadata } from "../config/index.js";
import { createProjectModel } from "../config/project.js";
import { lstatOrNull, readRelativeRegularFile } from "./files.js";
import { sameGitRemote } from "./git.js";
import {
  parseOpenSpecRoot,
  parseOpenSpecJson,
} from "./openspec-model.js";
import { createOpenSpecClient } from "./openspec-client.js";
import { POINTER_PATH, readPointer } from "./pointer.js";
import {
  isRecord,
  openSpecContractError,
  parseOpenSpecContract,
} from "./schema.js";

const STORE_DOCTOR_ENTRY_SCHEMA = z.looseObject({
  id: z.string().min(1),
  root: z.string().min(1),
  metadata: z.looseObject({
    id: z.string().min(1).optional(),
    present: z.boolean(),
    valid: z.boolean(),
  }),
  openspec_root: z.looseObject({ healthy: z.boolean() }),
});

const REQUIRED_ROOT_PATHS = Object.freeze([
  SERVICE_PATHS.storeMetadata,
  SERVICE_PATHS.orchestratorConfig,
  SERVICE_PATHS.openSpecConfig,
]);

/**
 * Проверяет обязательные файлы Store и блокирует symlink до чтения.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<boolean>} Содержит ли каталог обязательные файлы Core.
 */
async function hasRequiredRoot(candidate) {
  const stats = await Promise.all(
    REQUIRED_ROOT_PATHS.map((relativePath) => lstatOrNull(path.join(candidate, relativePath))),
  );
  for (const [index, stat] of stats.entries()) {
    if (stat?.isSymbolicLink()) {
      throw new Error(`${REQUIRED_ROOT_PATHS[index]} должна быть обычным файлом`);
    }
  }
  return stats.every((stat) => stat?.isFile());
}

/**
 * Подтверждает обязательную структуру Core в известном Store.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<string>} Канонический путь Store.
 */
export async function requireStoreRoot(candidate) {
  if (!(await hasRequiredRoot(candidate))) {
    throw new Error(`Разрешённый Store не содержит обязательные файлы OpenSpec Orchestrator: ${candidate}`);
  }
  return fs.realpath(candidate);
}

/**
 * Находит центральный Store среди текущего каталога и родителей.
 *
 * @param {string} [start] Начальный путь.
 * @returns {Promise<string>} Канонический путь Store.
 */
export async function findSpecRoot(start = process.cwd()) {
  let candidate = path.resolve(start);
  const initial = await lstatOrNull(candidate);
  if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
  if (!initial.isDirectory()) candidate = path.dirname(candidate);
  while (true) {
    if (await hasRequiredRoot(candidate)) return fs.realpath(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw Object.assign(
    new Error("Не удалось найти Spec Root среди родителей текущего каталога"),
    { code: "STORE_ROOT_NOT_FOUND" },
  );
}

/**
 * Находит корень Code Repository по config-only OpenSpec pointer.
 *
 * @param {string} start Начальный каталог.
 * @returns {Promise<string>} Канонический корень Code Repository.
 */
async function findCodeRepositoryRoot(start) {
  let candidate = path.resolve(start);
  const initial = await lstatOrNull(candidate);
  if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
  if (!initial.isDirectory()) candidate = path.dirname(candidate);
  while (true) {
    const pointer = await lstatOrNull(path.join(candidate, POINTER_PATH));
    if (pointer) return fs.realpath(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(
    `Не удалось найти Store или Code Repository с ${SERVICE_PATHS.openSpecConfig}`,
  );
}

/**
 * Разрешает Store как родительский root или через официальный OpenSpec context
 * из Code Repository. Это позволяет записывать Result Receipt из checkout кода.
 *
 * @param {string} start Начальный каталог команды.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Promise<string>} Канонический путь Store.
 */
export async function resolveCommandStoreRoot(start, commandRunner) {
  try {
    return await findSpecRoot(start);
  } catch (error) {
    if (error.code !== "STORE_ROOT_NOT_FOUND") throw error;
  }

  const repositoryRoot = await findCodeRepositoryRoot(start);
  const storeId = await readPointer(repositoryRoot);
  const command = "openspec context --json";
  const output = await createOpenSpecClient(repositoryRoot, commandRunner)
    .execute(["context", "--json"]);
  const response = parseOpenSpecJson(output, command);
  const root = parseOpenSpecRoot(response.root, command);
  if (root.source !== "declared" || root.store_id !== storeId || !path.isAbsolute(root.path)) {
    throw openSpecContractError(command, "pointer не разрешён в ожидаемый зарегистрированный Store");
  }
  const storeRoot = await requireStoreRoot(path.resolve(root.path));
  const { metadata } = await readStoreConfiguration(storeRoot);
  if (metadata.id !== storeId) {
    throw new Error(`OpenSpec pointer указывает Store ${storeId}, но metadata содержит ${metadata.id}`);
  }
  return storeRoot;
}

/**
 * Читает Core-owned Store metadata и конфигурацию и проверяет их общую identity.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @returns {Promise<{
 *   metadata: ReturnType<typeof parseStoreMetadata>,
 *   project: import("../config/project.js").ProjectModel
 * }>} Проверенные Store metadata и конфигурация.
 */
export async function readStoreConfiguration(projectRoot) {
  const [metadataSource, configSource] = await Promise.all([
    readRelativeRegularFile(projectRoot, SERVICE_PATHS.storeMetadata),
    readRelativeRegularFile(projectRoot, SERVICE_PATHS.orchestratorConfig),
  ]);
  const metadata = parseStoreMetadata(metadataSource);
  const config = parseOrchestratorConfig(configSource);
  const project = createProjectModel(config);
  if (project.storeRepository.id !== metadata.id) {
    throw new Error(
      `Store ID в ${SERVICE_PATHS.orchestratorConfig} не совпадает с Store metadata`,
    );
  }
  if (!metadata.remote || !sameGitRemote(project.storeRepository.remote, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  return { metadata, project };
}

/**
 * Проверяет metadata, здоровье и регистрацию Store из ответа store doctor.
 *
 * @param {import("./types.js").OpenSpecResponse} payload JSON-ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @returns {void}
 */
export function assertStoreDoctor(payload, storeId, projectRoot) {
  const command = `openspec store doctor ${storeId} --json`;
  if (!Array.isArray(payload.stores)) {
    throw openSpecContractError(command, "отсутствует stores[]");
  }
  const stores = payload.stores.filter((store) => isRecord(store) && store.id === storeId);
  if (stores.length !== 1) {
    throw new Error(
      `OpenSpec Orchestrator ожидал в ответе \`${command}\` ровно один Store ${storeId}, ` +
        `получено: ${stores.length}`,
    );
  }
  const store = parseOpenSpecContract(STORE_DOCTOR_ENTRY_SCHEMA, stores[0], command);
  if (path.resolve(store.root) !== projectRoot) {
    throw new Error(
      `OpenSpec Orchestrator ожидал Store ${storeId} по пути ${projectRoot}, ` +
        `но ответ \`${command}\` указал ${store.root}`,
    );
  }
  if (
    store.metadata.present !== true ||
    store.metadata.valid !== true ||
    store.openspec_root.healthy !== true
  ) {
    throw new Error(`Store ${storeId} не прошёл проверку здоровья \`${command}\``);
  }
  if (store.metadata.id !== undefined && store.metadata.id !== storeId) {
    throw new Error(
      `OpenSpec Orchestrator ожидал metadata.id ${storeId}, ` +
        `но ответ \`${command}\` указал ${store.metadata.id}`,
    );
  }
}
