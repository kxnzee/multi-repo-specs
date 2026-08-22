/** @fileoverview Публичный contract test kit для Plugin packages. */

import assert from "node:assert/strict";
import test from "node:test";

import { PluginPackage } from "./index.js";

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?=$|\s)/;
const PLUGIN_API_METHODS = Object.freeze([
  "supportsRole",
  "assertSupports",
  "hasRepositoryContribution",
  "connect",
  "status",
  "canSync",
  "sync",
  "hasAgentContribution",
  "integrateAgent",
  "hasCommandContribution",
  "registerCommands",
]);

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

/** Command contribution, проверенный без выполнения action. */
class ContractCommand {
  #definition;

  constructor(definition) {
    this.#definition = definition;
  }

  description(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      invalid(`Command '${this.#definition}' имеет неверное description`);
    }
    return this;
  }

  action(handler) {
    if (typeof handler !== "function") {
      invalid(`Command '${this.#definition}' имеет неверный action`);
    }
    return this;
  }
}

/** Ограниченный CommandRegistry для contract test. */
class ContractCommandRegistry {
  #commands = new Map();

  command(definition) {
    if (typeof definition !== "string" || definition.trim().length === 0) {
      invalid("Command definition должна быть непустой строкой");
    }
    const normalized = definition.trim();
    const match = normalized.match(COMMAND_NAME_PATTERN);
    if (!match) invalid(`Command '${normalized}' должна начинаться с kebab-case name`);
    const name = match[0].trim();
    if (this.#commands.has(name)) invalid(`повторяющаяся Command path '${name}'`);
    const command = new ContractCommand(normalized);
    this.#commands.set(name, command);
    return command;
  }

  verify() {
    return Object.freeze([...this.#commands.keys()]);
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
    const registry = new ContractCommandRegistry();
    if (this.#plugin.hasCommandContribution()) this.#plugin.registerCommands(registry);
    const commands = registry.verify();
    if (this.#plugin.hasCommandContribution() && commands.length === 0) {
      invalid("registerCommands не зарегистрировал ни одной Command");
    }
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
