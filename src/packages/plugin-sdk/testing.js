/** @fileoverview Публичный contract test kit для Plugin packages. */

import assert from "node:assert/strict";
import test from "node:test";

import { PluginPackage } from "./index.js";
import { PLUGIN_API_METHODS } from "./internal/constants.js";
import { inspectPluginCommands } from "./internal/command-executor.js";

/** Завершает contract test стабильной ошибкой SDK. */
function invalid(message) {
  throw new Error(`PLUGIN_CONTRACT_INVALID: ${message}`);
}

/** Проверяет публичный API без зависимости от instanceof и физической копии SDK. */
function assertPluginApi(plugin) {
  if (!plugin || typeof plugin !== "object") invalid("Plugin export должен быть объектом");
  if (typeof plugin.id !== "string" || !Array.isArray(plugin.supports)) {
    invalid("Plugin export не предоставляет identity");
  }
  for (const method of PLUGIN_API_METHODS) {
    if (typeof plugin[method] !== "function") {
      invalid(`Plugin export не предоставляет метод ${method}`);
    }
  }
}

/** Доменная проверка связки Plugin export и его Package manifest. */
export class PluginContract {
  #plugin;
  #pluginPackage;

  constructor({ plugin, packageManifest }) {
    assertPluginApi(plugin);
    this.#plugin = plugin;
    this.#pluginPackage = new PluginPackage(packageManifest);
    Object.freeze(this);
  }

  get package() {
    return this.#pluginPackage;
  }

  verify() {
    const commands = this.#plugin.hasCommandContribution()
      ? inspectPluginCommands((registry) => this.#plugin.registerCommands(registry))
      : Object.freeze([]);
    return Object.freeze({
      id: this.#plugin.id,
      commands,
    });
  }
}

/** Тонкий функциональный фасад проверки Package manifest. */
export function assertPluginPackageManifest(manifest) {
  return new PluginPackage(manifest).identity();
}

/** Тонкий функциональный фасад полной contract-проверки. */
export function assertPluginContract(options) {
  return new PluginContract(options).verify();
}

/** Регистрирует стандартный Node test для внешнего или bundled Plugin package. */
export function testPluginContract(options) {
  test(`${options.plugin.id} satisfies Plugin SDK contract`, () => {
    assert.doesNotThrow(() => assertPluginContract(options));
  });
}
