/** @fileoverview Публичный contract test kit для Plugin packages. */

import assert from "node:assert/strict";
import test from "node:test";

import { PluginPackage } from "./index.js";

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?=$|\s)/;
const OPTION_FLAGS_PATTERN = /^(?:-[a-zA-Z],\s*)?--[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\s+(?:<[^>]+>|\[[^\]]+\]))?$/;
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
  #action = false;
  #commands = new Map();
  #described = false;
  #definition;
  #options = new Set();

  constructor(definition) {
    this.#definition = definition;
  }

  description(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      invalid(`Command '${this.#definition}' имеет неверное description`);
    }
    this.#described = true;
    return this;
  }

  action(handler) {
    if (typeof handler !== "function") {
      invalid(`Command '${this.#definition}' имеет неверный action`);
    }
    if (this.#action) invalid(`Command '${this.#definition}' повторно объявила action`);
    this.#action = true;
    return this;
  }

  actionWithContext(handler, config = {}) {
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some((key) => key !== "scope") ||
      (config.scope !== undefined && !["current", "store"].includes(config.scope))
    ) {
      invalid(`Command '${this.#definition}' имеет неверный context scope`);
    }
    return this.action(handler);
  }

  command(definition) {
    if (typeof definition !== "string" || definition.trim().length === 0) {
      invalid(`Command '${this.#definition}' передала пустую вложенную command`);
    }
    const name = definition.trim().match(COMMAND_NAME_PATTERN)?.[0]?.trim();
    if (!name) invalid(`Command '${definition}' должна начинаться с kebab-case name`);
    if (this.#commands.has(name)) invalid(`повторяющаяся Command path '${name}'`);
    const command = new ContractCommand(definition.trim());
    this.#commands.set(name, command);
    return command;
  }

  option(flags, description, config = {}) {
    if (
      typeof flags !== "string" ||
      !OPTION_FLAGS_PATTERN.test(flags) ||
      typeof description !== "string" || description.trim().length === 0 ||
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some((key) => !["choices", "parser", "required"].includes(key)) ||
      (config.choices !== undefined && (
        !Array.isArray(config.choices) ||
        config.choices.length === 0 ||
        config.choices.some((choice) => typeof choice !== "string" || choice.length === 0) ||
        new Set(config.choices).size !== config.choices.length
      )) ||
      (config.parser !== undefined && typeof config.parser !== "function") ||
      (config.required !== undefined && typeof config.required !== "boolean")
    ) {
      invalid(`Command '${this.#definition}' имеет неверную option`);
    }
    const name = flags.match(/--[a-z][a-z0-9-]*/)?.[0];
    if (this.#options.has(name)) invalid(`Command '${this.#definition}' повторяет option '${name}'`);
    this.#options.add(name);
    return this;
  }

  verify(path) {
    if (!this.#described) invalid(`Command path '${path}' не имеет description`);
    if (!this.#action && this.#commands.size === 0) {
      invalid(`Command path '${path}' не имеет action`);
    }
    for (const [name, command] of this.#commands) command.verify(`${path} ${name}`);
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
    for (const [name, command] of this.#commands) command.verify(name);
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
