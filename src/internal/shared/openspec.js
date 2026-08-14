/** @fileoverview Общая структурная проверка машинных JSON-ответов OpenSpec. */

import path from "node:path";
import {
  isOpenSpecDiagnostic,
  isOpenSpecResponse,
  isOpenSpecRoot,
  isRecord,
  openSpecContractError,
} from "./schema.js";

/**
 * Запускает OpenSpec через переданный runner и разбирает JSON-ответ.
 *
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель внешних команд.
 * @param {string[]} args Аргументы OpenSpec.
 * @param {string} cwd Рабочий каталог.
 * @returns {import("./types.js").OpenSpecResponse} Проверенный ответ.
 */
export function runOpenSpecJson(commandRunner, args, cwd) {
  const command = `openspec ${args.join(" ")}`;
  return parseOpenSpecJson(commandRunner("openspec", args, { cwd }), command);
}

/**
 * Разбирает машинный ответ OpenSpec и не позволяет потерять диагностику,
 * которую команды doctor возвращают с успешным exit code.
 *
 * @param {string} output
 * @param {string} command
 * @returns {import("./types.js").OpenSpecResponse} Проверенный JSON-объект OpenSpec.
 */
export function parseOpenSpecJson(output, command) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw openSpecContractError(command, "ответ не является валидным JSON");
  }
  if (!isOpenSpecResponse(value)) {
    throw openSpecContractError(command, "несовместимый базовый формат JSON response");
  }
  assertNoOpenSpecErrors(value, command);
  return value;
}

/**
 * Рекурсивно проверяет только массивы OpenSpec `status`; остальные поля status
 * могут быть строковыми состояниями Change и диагностикой не являются.
 *
 * @param {unknown} value
 * @param {string} command Название команды для диагностического сообщения.
 * @returns {void}
 */
export function assertNoOpenSpecErrors(value, command) {
  const errors = [];

  /**
   * Собирает диагностические ошибки из вложенных массивов OpenSpec `status`.
   *
   * @param {unknown} current Текущий узел JSON-дерева.
   * @returns {void}
   */
  function visit(current) {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "status" && Array.isArray(item)) {
        for (const diagnostic of item) {
          if (!isOpenSpecDiagnostic(diagnostic)) {
            throw openSpecContractError(command, "несовместимый формат diagnostic в status[]");
          }
          if (diagnostic.severity === "error") errors.push(diagnostic);
        }
      } else {
        visit(item);
      }
    }
  }

  visit(value);
  if (errors.length === 0) return;
  const details = errors
    .map(({ code, message }) => `${code ? `${code}: ` : ""}${message ?? "неизвестная ошибка"}`)
    .join("; ");
  throw new Error(`${command} сообщила об ошибке: ${details}`);
}

/**
 * Проверяет, что OpenSpec разрешил ожидаемый Store, а не nearest/default root.
 *
 * @param {unknown} root Разрешённый OpenSpec root из JSON-ответа.
 * @param {{path: string, storeId: string, source: string}} expected Ожидаемая identity root.
 * @param {string} command Название команды для диагностического сообщения.
 * @returns {void}
 */
export function assertOpenSpecRoot(root, expected, command) {
  if (!isOpenSpecRoot(root)) {
    throw openSpecContractError(command, "не передана обязательная identity OpenSpec root");
  }
  if (path.resolve(root.path ?? "") !== path.resolve(expected.path)) {
    throw new Error(
      `OpenSpec Orchestrator ожидал root.path ${expected.path}, ` +
        `но ответ \`${command}\` указал ${root.path ?? "не указан"}`,
    );
  }
  if (root.source !== expected.source) {
    throw new Error(
      `OpenSpec Orchestrator ожидал root.source ${expected.source}, ` +
        `но ответ \`${command}\` указал ${root.source ?? "не указан"}`,
    );
  }
  if (root.store_id !== expected.storeId) {
    throw new Error(
      `OpenSpec Orchestrator ожидал root.store_id ${expected.storeId}, ` +
        `но ответ \`${command}\` указал ${root.store_id ?? "не указан"}`,
    );
  }
}

/**
 * Проверяет Store identity в результате команды OpenSpec store setup/register.
 *
 * @param {unknown} store Store из JSON-ответа OpenSpec.
 * @param {{path: string, storeId: string}} expected Ожидаемые ID и root Store.
 * @param {string} command Название команды для диагностического сообщения.
 * @returns {void}
 */
export function assertOpenSpecStore(store, expected, command) {
  if (!isRecord(store) || typeof store.id !== "string" || typeof store.root !== "string") {
    throw openSpecContractError(command, "не передана обязательная identity Store (id, root)");
  }
  if (store.id !== expected.storeId || path.resolve(store.root) !== path.resolve(expected.path)) {
    throw new Error(
      `OpenSpec Orchestrator ожидал Store ${expected.storeId} по пути ${expected.path}, ` +
        `но ответ \`${command}\` указал ${store.id} по пути ${store.root}`,
    );
  }
}
