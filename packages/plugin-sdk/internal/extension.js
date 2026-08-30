/** @fileoverview Data-only Extension contribution для Plugin SDK. */

import {
  DEFINITION_ID_PATTERN,
  REPOSITORY_ROLES,
  assertKnownKeys as assertKnownDefinitionKeys,
  assertPlainObject as assertPlainDefinitionObject,
} from "./validation.js";

const EXTENSION_KEYS = new Set(["id", "root", "target"]);
const TARGET_KEYS = new Set(["id", "role"]);

/** Завершает проверку Extension definition стабильной ошибкой SDK. */
function invalid(message) {
  throw new Error(`EXTENSION_DEFINITION_INVALID: ${message}`);
}

const assertPlainObject = (value, label) => assertPlainDefinitionObject(value, label, invalid);
const assertKnownKeys = (value, allowed, label) => (
  assertKnownDefinitionKeys(value, allowed, label, invalid)
);

/** Проверяет package-relative POSIX root. */
function extensionRoot(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("./") ||
    value.length <= 2 ||
    value.includes("\\") ||
    value.split("/").some((segment, index) => index > 0 && (!segment || segment === "." || segment === ".."))
  ) {
    invalid("root должен быть безопасным package-relative путём с префиксом './'");
  }
  return value;
}

/** Копирует минимальный Store/Repository target. */
function extensionTarget(value) {
  assertPlainObject(value, "target");
  assertKnownKeys(value, TARGET_KEYS, "target");
  if (typeof value.id !== "string" || !DEFINITION_ID_PATTERN.test(value.id)) {
    invalid("target.id должен быть lowercase kebab-case");
  }
  if (!REPOSITORY_ROLES.has(value.role)) {
    invalid("target.role должен быть store или code");
  }
  return Object.freeze({ id: value.id, role: value.role });
}

/** Immutable Extension definition без lifecycle callbacks. */
export class Extension {
  #id;
  #root;
  #target;

  constructor(definition) {
    assertPlainObject(definition, "Extension definition");
    assertKnownKeys(definition, EXTENSION_KEYS, "Extension definition");
    if (typeof definition.id !== "string" || !DEFINITION_ID_PATTERN.test(definition.id)) {
      invalid("id должен быть lowercase kebab-case");
    }
    this.#id = definition.id;
    this.#root = extensionRoot(definition.root);
    this.#target = extensionTarget(definition.target);
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get root() { return this.#root; }
  get target() { return this.#target; }
}

/** Создаёт проверенное data-only Extension contribution. */
export function defineExtension(definition) {
  return new Extension(definition);
}
