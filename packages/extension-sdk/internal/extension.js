/** @fileoverview Data-only Extension contribution shared with Plugin SDK. */

import { EXTENSION_ID_PATTERN } from "./package.js";

const ROLES = new Set(["store", "code"]);

/** Завершает definition validation стабильной ошибкой. */
function invalid(message) {
  throw new Error(`EXTENSION_DEFINITION_INVALID: ${message}`);
}

/** Проверяет plain object. */
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} должен быть object`);
}

/** Проверяет закрытый набор полей. */
function exactKeys(value, keys, label) {
  plain(value, label);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${label} содержит неизвестное поле '${unknown}'`);
}

export class Extension {
  constructor(definition) {
    exactKeys(definition, ["id", "root", "target"], "Extension definition");
    if (typeof definition.id !== "string" || !EXTENSION_ID_PATTERN.test(definition.id)) {
      invalid("id должен быть lowercase kebab-case");
    }
    if (
      typeof definition.root !== "string" ||
      !definition.root.startsWith("./") ||
      definition.root.length <= 2 ||
      definition.root.includes("\\") ||
      definition.root.split("/").some((part, index) => (
        index > 0 && (!part || part === "." || part === "..")
      ))
    ) {
      invalid("root должен быть безопасным package-relative путём с префиксом './'");
    }
    exactKeys(definition.target, ["id", "role"], "target");
    if (typeof definition.target.id !== "string" || !EXTENSION_ID_PATTERN.test(definition.target.id)) {
      invalid("target.id должен быть lowercase kebab-case");
    }
    if (!ROLES.has(definition.target.role)) invalid("target.role должен быть store или code");
    this.id = definition.id;
    this.root = definition.root;
    this.target = Object.freeze({ ...definition.target });
    Object.freeze(this);
  }
}

/** Создаёт проверенное data-only Extension contribution. */
export function defineExtension(definition) {
  return new Extension(definition);
}
