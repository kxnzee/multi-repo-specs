/** @fileoverview Чтение и общие проверки Store перед рабочими командами OpenSpec Orchestrator. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import * as z from "zod";

import { parseOrchestratorConfig, parseStoreMetadata } from "../config/index.js";
import { inspectOpenSpecCli, requireOpenSpecCapability } from "./compatibility.js";
import { lstatOrNull, readRelativeRegularFile } from "./files.js";
import { sameGitRemote } from "./git.js";
import {
  assertOpenSpecRoot,
  assertOpenSpecStore,
  runOpenSpecJson,
} from "./openspec.js";
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
  path.join(".openspec-store", "store.yaml"),
  "openspec-orch.yaml",
  path.join("openspec", "config.yaml"),
]);

/**
 * Проверяет обязательные файлы Store и блокирует symlink до чтения.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<boolean>} Содержит ли каталог обязательный Core skeleton.
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
 * Подтверждает обязательный Core skeleton в известном Store.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<string>} Канонический путь Store.
 */
export async function requireStoreRoot(candidate) {
  if (!(await hasRequiredRoot(candidate))) {
    throw new Error(`Разрешённый Store не содержит обязательный OpenSpec Orchestrator skeleton: ${candidate}`);
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
  throw new Error("Не удалось найти Spec Root среди родителей текущего каталога");
}

/**
 * Читает Core-owned Store metadata и конфигурацию и проверяет их общую identity.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @returns {Promise<{
 *   metadata: ReturnType<typeof parseStoreMetadata>,
 *   config: ReturnType<typeof parseOrchestratorConfig>
 * }>} Проверенные Store metadata и конфигурация.
 */
export async function readStoreConfiguration(projectRoot) {
  const [metadataSource, configSource] = await Promise.all([
    readRelativeRegularFile(projectRoot, ".openspec-store/store.yaml"),
    readRelativeRegularFile(projectRoot, "openspec-orch.yaml"),
  ]);
  const metadata = parseStoreMetadata(metadataSource);
  const config = parseOrchestratorConfig(configSource);
  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в openspec-orch.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.remote, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  return { metadata, config };
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

/**
 * Выполняет полный набор предпроверок OpenSpec Store.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Promise<Array<{name: string}>>} Активные Changes из разрешённого Store.
 */
export async function validateOpenSpec(projectRoot, storeId, commandRunner) {
  await inspectOpenSpecCli(commandRunner, projectRoot);

  const storeList = await runOpenSpecJson(commandRunner, ["store", "list", "--json"], projectRoot);
  requireOpenSpecCapability(
    Array.isArray(storeList.stores),
    "openspec store list --json: stores[]",
  );
  const registrations = storeList.stores.filter(
    (store) => isRecord(store) && store.id === storeId,
  );
  if (registrations.length !== 1) {
    throw new Error(`Store ${storeId} должен иметь ровно одну локальную регистрацию`);
  }
  assertOpenSpecStore(
    registrations[0],
    { path: projectRoot, storeId },
    "openspec store list --json",
  );

  const storeDoctor = await runOpenSpecJson(
    commandRunner,
    ["store", "doctor", storeId, "--json"],
    projectRoot,
  );
  assertStoreDoctor(storeDoctor, storeId, projectRoot);

  const doctorCommand = `openspec doctor --store ${storeId} --json`;
  const doctor = await runOpenSpecJson(
    commandRunner,
    ["doctor", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(doctor.root, { path: projectRoot, storeId, source: "store" }, doctorCommand);
  if (typeof doctor.root.healthy !== "boolean") {
    throw openSpecContractError(doctorCommand, "root не содержит boolean healthy");
  }
  if (!isRecord(doctor.store) || typeof doctor.store.id !== "string") {
    throw openSpecContractError(doctorCommand, "не передана обязательная Store identity");
  }
  if (doctor.root.healthy !== true) {
    throw new Error(`Store ${storeId} не прошёл проверку здоровья \`${doctorCommand}\``);
  }
  if (doctor.store.id !== storeId) {
    throw new Error(
      `OpenSpec Orchestrator ожидал Store ${storeId}, ` +
        `но ответ \`${doctorCommand}\` указал ${doctor.store.id}`,
    );
  }

  const contextCommand = `openspec context --store ${storeId} --json`;
  const context = await runOpenSpecJson(
    commandRunner,
    ["context", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(context.root, { path: projectRoot, storeId, source: "store" }, contextCommand);

  const changes = await runOpenSpecJson(
    commandRunner,
    ["list", "--changes", "--store", storeId, "--json"],
    projectRoot,
  );
  requireOpenSpecCapability(
    Array.isArray(changes.changes),
    "openspec list --changes --json: changes[]",
  );
  assertOpenSpecRoot(
    changes.root,
    { path: projectRoot, storeId, source: "store" },
    "openspec list --changes",
  );
  return changes.changes;
}
