/** @fileoverview Общие операции владения immutable domain values. */

/** Проверяет object без массивов. */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Проверяет object с точным набором собственных enumerable keys. */
export function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key));
}

/** Проверяет структурный method contract без привязки к prototype. */
export function hasMethods(value, methods) {
  return methods.every((method) => typeof value?.[method] === "function");
}

/** Рекурсивно блокирует изменение принадлежащего доменной модели значения. */
export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** Создаёт независимую immutable копию serializable domain value. */
export function ownValue(value) {
  return deepFreeze(globalThis.structuredClone(value));
}
