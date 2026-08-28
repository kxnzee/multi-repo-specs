/** @fileoverview Общие внутренние проверки публичных definitions Plugin SDK. */

export const DEFINITION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const REPOSITORY_ROLES = new Set(["store", "code"]);

/** Проверяет plain object без зависимости от конкретного prototype SDK. */
export function assertPlainObject(value, label, invalid) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} должен быть plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} должен быть plain object`);
  }
}

/** Запрещает неизвестные поля публичного контракта. */
export function assertKnownKeys(value, allowed, label, invalid) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} содержит неизвестное поле '${key}'`);
  }
}
