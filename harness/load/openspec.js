/** @fileoverview Структурные проверки штатного OpenSpec API для шага 05. */

import path from "node:path";

import { runOpenSpecJson } from "../shared/openspec.js";
import { isOpenSpecRoot, isRecord } from "../shared/schema.js";

/**
 * Проверяет официальный Store doctor и возвращает зарегистрированный root.
 *
 * @param {string} storeId
 * @param {string} codeRoot
 * @param {typeof import("../shared/command.js").runCommand} commandRunner
 * @returns {string}
 */
export function resolveHealthyStore(storeId, codeRoot, commandRunner) {
  const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], codeRoot);
  if (
    !isOpenSpecRoot(doctor.root) || doctor.root.source !== "declared" ||
    doctor.root.store_id !== storeId || doctor.root.healthy !== true
  ) {
    throw new Error(`openspec doctor --json не разрешила объявленный Store ${storeId}`);
  }
  const storeRoot = path.resolve(doctor.root.path);
  const storeDoctor = runOpenSpecJson(
    commandRunner,
    ["store", "doctor", storeId, "--json"],
    codeRoot,
  );
  if (!Array.isArray(storeDoctor.stores)) {
    throw new Error("openspec store doctor вернула некорректный список Stores");
  }
  const matches = storeDoctor.stores.filter((item) => isRecord(item) && item.id === storeId);
  if (matches.length !== 1) throw new Error(`openspec store doctor не подтвердила Store ${storeId}`);
  const inspected = matches[0];
  if (path.resolve(String(inspected.root ?? "")) !== storeRoot) {
    throw new Error(`openspec store doctor разрешила другой root для Store ${storeId}`);
  }
  if (
    !isRecord(inspected.metadata) || inspected.metadata.present !== true || inspected.metadata.valid !== true ||
    (inspected.metadata.id !== undefined && inspected.metadata.id !== storeId) ||
    !isRecord(inspected.openspec_root) || inspected.openspec_root.healthy !== true
  ) {
    throw new Error(`openspec store doctor не подтвердила исправный Store ${storeId}`);
  }
  return storeRoot;
}

/** @param {unknown} root @param {string} expected @param {string} command */
function assertNearestRoot(root, expected, command) {
  if (!isOpenSpecRoot(root) || path.resolve(root.path) !== expected || root.source !== "nearest") {
    throw new Error(`${command} не использовала точный runtime worktree`);
  }
}

/**
 * Валидирует Change и выбранные Tasks штатными командами OpenSpec.
 *
 * @param {object} options
 * @param {string} options.worktreeRoot
 * @param {string} options.changeId
 * @param {string[]} options.workPackages
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner
 * @returns {Array<{id: string, description: string}>}
 */
export function validateImplementationInput({ worktreeRoot, changeId, workPackages, commandRunner }) {
  const validation = runOpenSpecJson(
    commandRunner,
    ["validate", changeId, "--type", "change", "--strict", "--no-interactive", "--json"],
    worktreeRoot,
  );
  assertNearestRoot(validation.root, worktreeRoot, "openspec validate");
  if (!Array.isArray(validation.items) || validation.items.length !== 1) {
    throw new Error("openspec validate должна вернуть ровно один Change");
  }
  const item = validation.items[0];
  if (!isRecord(item) || item.id !== changeId || item.type !== "change" || item.valid !== true) {
    throw new Error(`OpenSpec Change ${changeId} не прошёл строгую validation`);
  }

  const instructions = runOpenSpecJson(
    commandRunner,
    ["instructions", "apply", "--change", changeId, "--json"],
    worktreeRoot,
  );
  assertNearestRoot(instructions.root, worktreeRoot, "openspec instructions apply");
  if (instructions.changeName !== changeId || instructions.state !== "ready" || !Array.isArray(instructions.tasks)) {
    throw new Error(`OpenSpec Change ${changeId} не готов к apply`);
  }
  const selectedTasks = [];
  for (const workPackage of workPackages) {
    const matches = instructions.tasks.filter((task) => isRecord(task) && task.id === workPackage);
    if (matches.length !== 1) throw new Error(`Work Package ${workPackage} не найден однозначно в OpenSpec Tasks`);
    if (
      typeof matches[0].description !== "string" || matches[0].description.length === 0 ||
      typeof matches[0].done !== "boolean"
    ) {
      throw new Error(`Work Package ${workPackage} имеет некорректный OpenSpec JSON contract`);
    }
    if (matches[0].done) throw new Error(`Work Package ${workPackage} уже выполнен`);
    selectedTasks.push({ id: workPackage, description: matches[0].description });
  }
  return selectedTasks;
}
