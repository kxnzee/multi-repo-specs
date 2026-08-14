/** @fileoverview Schema-neutral проверки штатного OpenSpec API для подготовки реализации. */

import path from "node:path";
import * as z from "zod";

import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { resolveContainedExistingPath } from "../shared/files.js";
import { parseOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import {
  openSpecContractError,
  parseOpenSpecContract,
} from "../shared/schema.js";
import { assertStoreDoctor } from "../shared/store.js";

const NON_EMPTY_STRING = z.string().min(1);
const CONTEXT_FILES_SCHEMA = z.record(NON_EMPTY_STRING, z.array(NON_EMPTY_STRING));
const VALIDATION_SCHEMA = z.looseObject({
  items: z.array(z.looseObject({
    id: NON_EMPTY_STRING,
    type: NON_EMPTY_STRING,
    valid: z.boolean(),
  })).length(1),
});
const TASK_SCHEMA = z.looseObject({
  id: NON_EMPTY_STRING,
  description: NON_EMPTY_STRING,
  done: z.boolean(),
});
const APPLY_SCHEMA = z.looseObject({
  changeName: NON_EMPTY_STRING,
  changeDir: NON_EMPTY_STRING,
  schemaName: NON_EMPTY_STRING,
  contextFiles: CONTEXT_FILES_SCHEMA,
  state: NON_EMPTY_STRING,
  tasks: z.array(TASK_SCHEMA),
});

/**
 * Проверяет официальный Store doctor и возвращает зарегистрированный root.
 *
 * @param {string} storeId
 * @param {string} codeRoot
 * @param {typeof import("../shared/command.js").runCommand} commandRunner
 * @returns {Promise<string>}
 */
export async function resolveHealthyStore(storeId, codeRoot, commandRunner) {
  await inspectOpenSpecCli(commandRunner, codeRoot);
  const command = "openspec doctor --json";
  const doctor = await runOpenSpecJson(commandRunner, ["doctor", "--json"], codeRoot);
  const root = parseOpenSpecRoot(doctor.root, command);
  if (root.source !== "declared" || root.store_id !== storeId) {
    throw new Error(
      `OpenSpec Orchestrator ожидал declared Store ${storeId}, ` +
        `но ответ \`${command}\` указал source=${root.source}, ` +
        `store_id=${root.store_id ?? "не указан"}`,
    );
  }
  if (typeof root.healthy !== "boolean") {
    throw openSpecContractError(command, "root не содержит boolean healthy");
  }
  if (!root.healthy) {
    throw new Error(`Store ${storeId} не прошёл проверку здоровья \`${command}\``);
  }
  const storeRoot = path.resolve(root.path);
  const storeDoctor = await runOpenSpecJson(
    commandRunner,
    ["store", "doctor", storeId, "--json"],
    codeRoot,
  );
  assertStoreDoctor(storeDoctor, storeId, storeRoot);
  return storeRoot;
}

/** @param {unknown} root @param {string} expected @param {string} command */
function assertNearestRoot(root, expected, command) {
  const actual = parseOpenSpecRoot(root, command);
  if (path.resolve(actual.path) !== expected || actual.source !== "nearest") {
    throw new Error(
      `OpenSpec Orchestrator ожидал runtime root ${expected} с source=nearest, ` +
        `но ответ \`${command}\` указал root=${actual.path}, source=${actual.source}`,
    );
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
  const result = {};
  for (const [artifactId, files] of Object.entries(value)) {
    const normalized = [];
    for (const file of files) {
      const resolved = await resolveContainedExistingPath(
        changeRoot,
        file,
        `OpenSpec contextFiles.${artifactId}`,
        "file",
      );
      if (normalized.includes(resolved)) {
        throw openSpecContractError(
          "openspec instructions apply --json",
          `contextFiles.${artifactId} содержит повторяющийся путь`,
        );
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
  const validation = await runOpenSpecJson(
    commandRunner,
    validationArgs,
    worktreeRoot,
  );
  assertNearestRoot(validation.root, worktreeRoot, "openspec validate");
  const parsedValidation = parseOpenSpecContract(
    VALIDATION_SCHEMA,
    validation,
    "openspec validate --json",
  );
  const item = parsedValidation.items[0];
  if (item.id !== changeId) {
    throw new Error(
      `Ответ \`openspec validate --json\` относится к Change ${item.id}, ожидался ${changeId}`,
    );
  }
  if (item.type !== "change" || item.valid !== true) {
    throw new Error(`OpenSpec Change ${changeId} не прошёл validation`);
  }

  const instructions = await runOpenSpecJson(
    commandRunner,
    ["instructions", "apply", "--change", changeId, "--json"],
    worktreeRoot,
  );
  assertNearestRoot(instructions.root, worktreeRoot, "openspec instructions apply");
  const apply = parseOpenSpecContract(
    APPLY_SCHEMA,
    instructions,
    "openspec instructions apply --json",
  );
  if (apply.changeName !== changeId) {
    throw new Error(
      `Ответ \`openspec instructions apply --json\` относится к Change ${apply.changeName}, ` +
      `ожидался ${changeId}`,
    );
  }
  if (apply.state !== "ready") {
    throw new Error(`OpenSpec Change ${changeId} не готов к apply: state=${apply.state}`);
  }
  const changeRoot = await resolveContainedExistingPath(
    worktreeRoot,
    apply.changeDir,
    "OpenSpec Apply changeDir",
    "directory",
  );
  const contextFiles = await normalizeContextFiles(changeRoot, apply.contextFiles);

  const tasks = new Map();
  for (const task of apply.tasks) {
    if (tasks.has(task.id)) {
      throw openSpecContractError("openspec instructions apply --json", `повторяется task ${task.id}`);
    }
    tasks.set(task.id, task);
  }

  if (tasks.size === 0) {
    if (workPackages.length > 0) {
      throw new Error("Эта OpenSpec schema не возвращает адресуемые Tasks; --work-package использовать нельзя");
    }
    return {
      schema: apply.schemaName,
      changeRoot,
      implementationMode: "whole-change",
      contextFiles,
      selectedTasks: [],
    };
  }
  if (workPackages.length === 0) {
    throw new Error("Для ответа с адресуемыми OpenSpec Tasks требуется --work-package <id>");
  }

  const selectedTasks = [];
  for (const workPackage of workPackages) {
    const task = tasks.get(workPackage);
    if (!task) throw new Error(`Work Package ${workPackage} не найден в OpenSpec Tasks`);
    if (task.done) throw new Error(`Work Package ${workPackage} уже выполнен`);
    selectedTasks.push({ id: task.id, description: task.description });
  }
  return {
    schema: apply.schemaName,
    changeRoot,
    implementationMode: "package",
    contextFiles,
    selectedTasks,
  };
}
