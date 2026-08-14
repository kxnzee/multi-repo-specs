/** @fileoverview Формирование канонического Change ID из внешнего ticket и короткого имени. */

import { assertRepositoryId } from "../config/index.js";
import { validateTicket } from "../explore/validation/ticket.js";

const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Проверяет короткое имя Change без скрытой нормализации.
 *
 * @param {unknown} name Пользовательское короткое имя.
 * @returns {string} Проверенное lowercase kebab-case имя.
 */
export function validateChangeName(name) {
  if (typeof name !== "string" || !CHANGE_NAME_PATTERN.test(name)) {
    throw new Error("Короткое имя Change должно быть в lowercase kebab-case, например payment-status");
  }
  return name;
}

/**
 * Строит единый идентификатор `<ticket-lowercase>-<name>`.
 *
 * @param {string} ticket Внешний ticket key.
 * @param {string} name Короткое имя Change.
 * @returns {string} Канонический Change ID.
 */
export function buildChangeId(ticket, name) {
  const changeId = `${validateTicket(ticket).toLowerCase()}-${validateChangeName(name)}`;
  return assertRepositoryId(changeId, "Change ID");
}
