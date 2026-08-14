/** @fileoverview Общие проверки OpenSpec Store перед рабочими командами OpenSpec Orchestrator. */

import path from "node:path";

import { assertSupportedOpenSpecVersion } from "../config/index.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "./openspec.js";

/**
 * Проверяет metadata, здоровье и регистрацию Store из ответа store doctor.
 *
 * @param {import("./types.js").OpenSpecResponse} payload JSON-ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @returns {void}
 */
function assertStoreDoctor(payload, storeId, projectRoot) {
  const stores = Array.isArray(payload.stores)
    ? payload.stores.filter(({ id }) => id === storeId)
    : [];
  if (stores.length !== 1) {
    throw new Error(`openspec store doctor не вернула ровно один Store ${storeId}`);
  }
  const store = stores[0];
  if (path.resolve(store.root ?? "") !== projectRoot) {
    throw new Error(`Store ${storeId} зарегистрирован по другому пути: ${store.root ?? "не указан"}`);
  }
  if (
    store.metadata?.present !== true ||
    store.metadata?.valid !== true ||
    store.openspec_root?.healthy !== true
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
 * @param {string} configuredVersion Закреплённая версия OpenSpec из openspec-orch.yaml.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Array<{name: string}>} Активные Changes из разрешённого Store.
 */
export function validateOpenSpec(projectRoot, storeId, configuredVersion, commandRunner) {
  assertSupportedOpenSpecVersion(configuredVersion);
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: projectRoot });
  if (installedVersion !== configuredVersion) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${configuredVersion}`);
  }

  const storeList = runOpenSpecJson(commandRunner, ["store", "list", "--json"], projectRoot);
  const registrations = Array.isArray(storeList.stores)
    ? storeList.stores.filter(({ id }) => id === storeId)
    : [];
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
  if (!Array.isArray(specs.specs)) throw new Error("openspec list --specs не вернула specs");
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
  if (!Array.isArray(changes.changes)) {
    throw new Error("openspec list --changes не вернула Changes");
  }
  assertOpenSpecRoot(
    changes.root,
    { path: projectRoot, storeId, source: "store" },
    "openspec list --changes",
  );
  return changes.changes;
}
