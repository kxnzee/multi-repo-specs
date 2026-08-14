/** @fileoverview Чтение и общие проверки Store перед рабочими командами OpenSpec Orchestrator. */

import path from "node:path";

import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  sameGitRemote,
} from "../config/index.js";
import { inspectOpenSpecCli, requireOpenSpecCapability } from "./compatibility.js";
import { readRelativeRegularFile } from "./files.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "./openspec.js";
import { isRecord } from "./schema.js";

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
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
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
  const stores = Array.isArray(payload.stores)
    ? payload.stores.filter((store) => isRecord(store) && store.id === storeId)
    : [];
  if (stores.length !== 1) {
    throw new Error(`openspec store doctor не вернула ровно один Store ${storeId}`);
  }
  const store = stores[0];
  if (path.resolve(store.root ?? "") !== projectRoot) {
    throw new Error(`Store ${storeId} зарегистрирован по другому пути: ${store.root ?? "не указан"}`);
  }
  if (
    !isRecord(store.metadata) ||
    store.metadata.present !== true ||
    store.metadata.valid !== true ||
    !isRecord(store.openspec_root) ||
    store.openspec_root.healthy !== true
  ) {
    throw new Error(`openspec store doctor не подтвердила исправный Store ${storeId}`);
  }
  if (store.metadata.id !== undefined && store.metadata.id !== storeId) {
    throw new Error(`openspec store doctor вернула другой Store ID: ${store.metadata.id}`);
  }
}

/**
 * Выполняет полный набор предпроверок OpenSpec Store.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Array<{name: string}>} Активные Changes из разрешённого Store.
 */
export function validateOpenSpec(projectRoot, storeId, commandRunner) {
  inspectOpenSpecCli(commandRunner, projectRoot);

  const storeList = runOpenSpecJson(commandRunner, ["store", "list", "--json"], projectRoot);
  requireOpenSpecCapability(
    Array.isArray(storeList.stores),
    "openspec store list --json: stores[]",
  );
  const registrations = storeList.stores.filter(({ id }) => id === storeId);
  if (registrations.length !== 1 || path.resolve(registrations[0].root ?? "") !== projectRoot) {
    throw new Error(`Store ${storeId} не зарегистрирован по ожидаемому пути ${projectRoot}`);
  }

  const storeDoctor = runOpenSpecJson(
    commandRunner,
    ["store", "doctor", storeId, "--json"],
    projectRoot,
  );
  assertStoreDoctor(storeDoctor, storeId, projectRoot);

  const doctorCommand = `openspec doctor --store ${storeId} --json`;
  const doctor = runOpenSpecJson(
    commandRunner,
    ["doctor", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(doctor.root, { path: projectRoot, storeId, source: "store" }, doctorCommand);
  if (doctor.root.healthy !== true || doctor.store?.id !== storeId) {
    throw new Error(`${doctorCommand} не подтвердила исправный Store`);
  }

  const contextCommand = `openspec context --store ${storeId} --json`;
  const context = runOpenSpecJson(
    commandRunner,
    ["context", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(context.root, { path: projectRoot, storeId, source: "store" }, contextCommand);

  const specs = runOpenSpecJson(
    commandRunner,
    ["list", "--specs", "--store", storeId, "--json"],
    projectRoot,
  );
  requireOpenSpecCapability(
    Array.isArray(specs.specs),
    "openspec list --specs --json: specs[]",
  );
  assertOpenSpecRoot(
    specs.root,
    { path: projectRoot, storeId, source: "store" },
    "openspec list --specs",
  );

  const changes = runOpenSpecJson(
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
