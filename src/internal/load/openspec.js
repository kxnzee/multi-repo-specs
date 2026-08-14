/** @fileoverview Schema-neutral проверки штатного OpenSpec API для подготовки реализации. */

import path from "node:path";

import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { resolveContainedExistingPath } from "../shared/files.js";
import { runOpenSpecJson } from "../shared/openspec.js";
import { isOpenSpecRoot, isRecord } from "../shared/schema.js";
import { assertStoreDoctor } from "../shared/store.js";

/**
 * Проверяет официальный Store doctor и возвращает зарегистрированный root.
 *
 * @param {string} storeId
 * @param {string} codeRoot
 * @param {typeof import("../shared/command.js").runCommand} commandRunner
 * @returns {string}
 */
export function resolveHealthyStore(storeId, codeRoot, commandRunner) {
  inspectOpenSpecCli(commandRunner, codeRoot);
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
  assertStoreDoctor(storeDoctor, storeId, storeRoot);
  return storeRoot;
}

/** @param {unknown} root @param {string} expected @param {string} command */
function assertNearestRoot(root, expected, command) {
  if (!isOpenSpecRoot(root) || path.resolve(root.path) !== expected || root.source !== "nearest") {
    throw new Error(`${command} не использовала точный runtime worktree`);
  }
}

/**
 * Проверяет contextFiles из официального Apply response.
 *
 * @param {string} changeRoot
 * @param {unknown} value
 * @returns {Promise<Record<string, string[]>>}
 */
async function normalizeContextFiles(changeRoot, value) {
  if (!isRecord(value)) {
    throw new Error("openspec instructions apply вернула некорректный contextFiles");
  }
  const result = {};
  for (const [artifactId, files] of Object.entries(value)) {
    if (!artifactId || !Array.isArray(files)) {
      throw new Error("openspec instructions apply вернула некорректный contextFiles");
    }
    const normalized = [];
    for (const file of files) {
      const resolved = await resolveContainedExistingPath(
        changeRoot,
        file,
        `OpenSpec contextFiles.${artifactId}`,
        "file",
      );
      if (normalized.includes(resolved)) {
        throw new Error(`OpenSpec contextFiles.${artifactId} содержит повторяющийся путь`);
      }
      normalized.push(resolved);
    }
    result[artifactId] = normalized;
  }
  return result;
}

/**
 * Валидирует Change и выбирает package-mode либо whole-change mode по Apply response.
 *
 * @param {object} options
 * @param {string} options.worktreeRoot
 * @param {string} options.changeId
 * @param {string[]} options.workPackages
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner
 * @param {boolean} options.strict OpenSpec validation mode.
 * @returns {Promise<{schema: string, changeRoot: string, implementationMode: "package" | "whole-change", contextFiles: Record<string, string[]>, selectedTasks: Array<{id: string, description: string}>}>}
 */
export async function validateImplementationInput({
  worktreeRoot,
  changeId,
  workPackages,
  commandRunner,
  strict,
}) {
  const validationArgs = [
    "validate",
    changeId,
    "--type",
    "change",
    ...(strict ? ["--strict"] : []),
    "--no-interactive",
    "--json",
  ];
  const validation = runOpenSpecJson(
    commandRunner,
    validationArgs,
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
  if (
    instructions.changeName !== changeId || instructions.state !== "ready" ||
    typeof instructions.schemaName !== "string" || !instructions.schemaName ||
    !Array.isArray(instructions.tasks)
  ) {
    throw new Error(`OpenSpec Change ${changeId} не готов к apply`);
  }
  const changeRoot = await resolveContainedExistingPath(
    worktreeRoot,
    instructions.changeDir,
    "OpenSpec Apply changeDir",
    "directory",
  );
  const contextFiles = await normalizeContextFiles(changeRoot, instructions.contextFiles);

  const tasks = new Map();
  for (const task of instructions.tasks) {
    if (
      !isRecord(task) || typeof task.id !== "string" || !task.id || tasks.has(task.id) ||
      typeof task.description !== "string" || !task.description || typeof task.done !== "boolean"
    ) {
      throw new Error("OpenSpec Tasks имеют некорректный JSON contract");
    }
    tasks.set(task.id, task);
  }

  if (tasks.size === 0) {
    if (workPackages.length > 0) {
      throw new Error("Эта OpenSpec schema не возвращает адресуемые Tasks; --work-package использовать нельзя");
    }
    return {
      schema: instructions.schemaName,
      changeRoot,
      implementationMode: "whole-change",
      contextFiles,
      selectedTasks: [],
    };
  }
  if (workPackages.length === 0) {
    throw new Error("OpenSpec вернула адресуемые Tasks; для package-mode требуется --work-package <id>");
  }

  const selectedTasks = [];
  for (const workPackage of workPackages) {
    const task = tasks.get(workPackage);
    if (!task) throw new Error(`Work Package ${workPackage} не найден в OpenSpec Tasks`);
    if (task.done) throw new Error(`Work Package ${workPackage} уже выполнен`);
    selectedTasks.push({ id: task.id, description: task.description });
  }
  return {
    schema: instructions.schemaName,
    changeRoot,
    implementationMode: "package",
    contextFiles,
    selectedTasks,
  };
}
