/** @fileoverview Общие операции владения immutable domain values. */

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
