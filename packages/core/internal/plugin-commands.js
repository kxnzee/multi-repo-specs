/** @fileoverview Безопасный монтаж Plugin command contributions в candidate CLI. */

import { Command, InvalidArgumentError, Option } from "commander";

import { CORE_CLI_COMMANDS, CORE_PATTERNS } from "./constants.js";
import { PluginRegistry } from "./plugin-host.js";
import { ownValue } from "./value.js";

const IMPLICIT_ROOT_COMMANDS = new Set(CORE_CLI_COMMANDS.implicit);
const COMMAND_CONTEXT_SCOPES = new Set(["current", "store"]);
const COMMAND_CONTEXT_KEYS = new Set(["scope", "requireBinding"]);

/** Извлекает проверенное имя команды из Commander definition. */
function commandName(definition, pluginId) {
  if (typeof definition !== "string" || definition.trim().length === 0) {
    throw new Error(`PLUGIN_COMMAND_INVALID: ${pluginId} передал пустую command definition`);
  }
  const normalized = definition.trim();
  const match = normalized.match(CORE_PATTERNS.commandDefinitionName);
  if (!match) {
    throw new Error(
      `PLUGIN_COMMAND_INVALID: ${pluginId} command '${normalized}' должна начинаться с kebab-case name`,
    );
  }
  return Object.freeze({ definition: normalized, name: match[0].trim() });
}

/** Keeps Commander error semantics without exposing Commander through the Plugin SDK. */
function optionParser(parser) {
  if (parser === undefined) return undefined;
  return (...args) => {
    try {
      return parser(...args);
    } catch (error) {
      if (error instanceof InvalidArgumentError) throw error;
      throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
    }
  };
}

/** Ограниченный builder без доступа Plugin к Commander instance. */
export class PluginCommandBuilder {
  #command;
  #commands = new Set();
  #path;
  #pluginId;
  #resolveContext;

  constructor(command, pluginId, resolveContext, commandPath) {
    if (!(command instanceof Command)) {
      throw new Error("PLUGIN_COMMAND_INVALID: требуется Commander Command");
    }
    if (typeof resolveContext !== "function" || !Array.isArray(commandPath)) {
      throw new Error("PLUGIN_COMMAND_INVALID: требуется command context resolver и path");
    }
    this.#command = command;
    this.#pluginId = pluginId;
    this.#resolveContext = resolveContext;
    this.#path = Object.freeze([...commandPath]);
    Object.freeze(this);
  }

  description(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`PLUGIN_COMMAND_INVALID: ${this.#pluginId} передал пустое description`);
    }
    this.#command.description(value);
    return this;
  }

  action(handler) {
    if (typeof handler !== "function") {
      throw new Error(`PLUGIN_COMMAND_INVALID: ${this.#pluginId} action должен быть функцией`);
    }
    this.#command.action((...args) => {
      args.pop();
      const options = args.pop();
      return handler(...args, ownValue(options));
    });
    return this;
  }

  actionWithContext(handler, config = {}) {
    if (typeof handler !== "function") {
      throw new Error(`PLUGIN_COMMAND_INVALID: ${this.#pluginId} action должен быть функцией`);
    }
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some((key) => !COMMAND_CONTEXT_KEYS.has(key))
    ) {
      throw new Error(
        `PLUGIN_COMMAND_INVALID: ${this.#pluginId} context config должен быть object`,
      );
    }
    const scope = config.scope ?? "current";
    if (!COMMAND_CONTEXT_SCOPES.has(scope)) {
      throw new Error(
        `PLUGIN_COMMAND_INVALID: ${this.#pluginId} context scope должен быть current или store`,
      );
    }
    const requireBinding = config.requireBinding ?? true;
    if (typeof requireBinding !== "boolean") {
      throw new Error(
        `PLUGIN_COMMAND_INVALID: ${this.#pluginId} requireBinding должен быть boolean`,
      );
    }
    this.#command.action(async (...args) => {
      args.pop();
      const options = ownValue(args.pop());
      const context = await this.#resolveContext(this.#pluginId, scope, requireBinding);
      return handler(context, ...args, options);
    });
    return this;
  }

  command(definition) {
    const parsed = commandName(definition, this.#pluginId);
    const fullPath = [...this.#path, parsed.name].join(" ");
    if (
      this.#commands.has(parsed.name) ||
      this.#command.commands.some((command) => command.name() === parsed.name)
    ) {
      throw new Error(`PLUGIN_COMMAND_CONFLICT: command path '${fullPath}' уже зарегистрирован`);
    }
    this.#commands.add(parsed.name);
    return new PluginCommandBuilder(
      this.#command.command(parsed.definition),
      this.#pluginId,
      this.#resolveContext,
      [...this.#path, parsed.name],
    );
  }

  option(flags, description, { choices, parser, required = false } = {}) {
    const option = new Option(flags, description);
    if (choices !== undefined) option.choices(choices);
    if (parser !== undefined) option.argParser(optionParser(parser));
    if (required) option.makeOptionMandatory();
    this.#command.addOption(option);
    return this;
  }
}

/** CommandRegistry одного Plugin с проверкой полного command path. */
export class PluginCommandRegistry {
  #allowedCommands;
  #commands = new Set();
  #parent;
  #path;
  #pluginId;
  #resolveContext;

  constructor({ allowedCommands, parent, path: parentPath, pluginId, resolveContext }) {
    if (
      !(parent instanceof Command) ||
      !Array.isArray(parentPath) ||
      (allowedCommands !== undefined && !(allowedCommands instanceof Set)) ||
      typeof resolveContext !== "function"
    ) {
      throw new Error("PLUGIN_COMMAND_INVALID: требуется command parent, path и context resolver");
    }
    this.#parent = parent;
    this.#path = Object.freeze([...parentPath]);
    this.#pluginId = pluginId;
    this.#allowedCommands = allowedCommands;
    this.#resolveContext = resolveContext;
    Object.freeze(this);
  }

  command(definition) {
    const parsed = commandName(definition, this.#pluginId);
    if (this.#allowedCommands && !this.#allowedCommands.has(parsed.name)) {
      throw new Error(
        `PLUGIN_COMMAND_RESERVED: ${this.#pluginId} не разрешена root command '${parsed.name}'`,
      );
    }
    const conflict = this.#commands.has(parsed.name) ||
      this.#parent.commands.some((command) => command.name() === parsed.name) ||
      IMPLICIT_ROOT_COMMANDS.has(parsed.name);
    const fullPath = [...this.#path, parsed.name].join(" ");
    if (conflict) {
      throw new Error(`PLUGIN_COMMAND_CONFLICT: command path '${fullPath}' уже зарегистрирован`);
    }
    this.#commands.add(parsed.name);
    const command = this.#parent.command(parsed.definition);
    return new PluginCommandBuilder(
      command,
      this.#pluginId,
      this.#resolveContext,
      [...this.#path, parsed.name],
    );
  }

  get size() {
    return this.#commands.size;
  }

  list() {
    return Object.freeze([...this.#commands]);
  }
}

/** Монтирует все command contributions в стабильном порядке Plugin registry. */
export class PluginCommandMounter {
  #registry;
  #resolveContext;
  #rootCommands;

  constructor({ registry, resolveContext, rootCommands = new Map() } = {}) {
    if (!(registry instanceof PluginRegistry)) {
      throw new Error("PLUGIN_COMMAND_MOUNTER_INVALID: требуется PluginRegistry");
    }
    if (!(rootCommands instanceof Map)) {
      throw new Error("PLUGIN_COMMAND_MOUNTER_INVALID: rootCommands должен быть Map");
    }
    if (typeof resolveContext !== "function") {
      throw new Error("PLUGIN_COMMAND_MOUNTER_INVALID: resolveContext должен быть функцией");
    }
    const loadedIds = new Set(registry.list().map(({ id }) => id));
    const checkedRootCommands = new Map();
    for (const [pluginId, names] of rootCommands) {
      if (!loadedIds.has(pluginId)) {
        throw new Error(`PLUGIN_COMMAND_MOUNTER_INVALID: root Plugin '${pluginId}' не загружен`);
      }
      if (!Array.isArray(names) || names.length === 0) {
        throw new Error(
          `PLUGIN_COMMAND_MOUNTER_INVALID: root Plugin '${pluginId}' требует список команд`,
        );
      }
      const checkedNames = names.map((name) => {
        const parsed = commandName(name, pluginId);
        if (parsed.name !== parsed.definition) {
          throw new Error(
            `PLUGIN_COMMAND_MOUNTER_INVALID: root policy принимает только command names`,
          );
        }
        return parsed.name;
      });
      if (new Set(checkedNames).size !== checkedNames.length) {
        throw new Error(
          `PLUGIN_COMMAND_MOUNTER_INVALID: root commands '${pluginId}' не должны повторяться`,
        );
      }
      checkedRootCommands.set(pluginId, new Set(checkedNames));
    }
    this.#registry = registry;
    this.#resolveContext = resolveContext;
    this.#rootCommands = checkedRootCommands;
    Object.freeze(this);
  }

  mount(program) {
    if (!(program instanceof Command)) {
      throw new Error("PLUGIN_COMMAND_MOUNTER_INVALID: требуется Commander program");
    }
    for (const { plugin } of this.#registry.list()) {
      const contributes = plugin.hasCommandContribution();
      if (typeof contributes !== "boolean") {
        throw new Error(
          `PLUGIN_CONTRACT_INVALID: ${plugin.id}.hasCommandContribution должен вернуть boolean`,
        );
      }
      const allowedRootCommands = this.#rootCommands.get(plugin.id);
      if (!contributes) {
        if (allowedRootCommands) {
          throw new Error(
            `PLUGIN_CONTRACT_INVALID: ${plugin.id} не предоставляет разрешённые root commands`,
          );
        }
        continue;
      }
      const root = allowedRootCommands !== undefined;
      let parent = program;
      if (!root) {
        if (
          IMPLICIT_ROOT_COMMANDS.has(plugin.id) ||
          program.commands.some((command) => command.name() === plugin.id)
        ) {
          throw new Error(
            `PLUGIN_COMMAND_CONFLICT: command path '${plugin.id}' уже зарегистрирован`,
          );
        }
        parent = program.command(plugin.id).description(`Команды Plugin ${plugin.id}`);
      }
      const registry = new PluginCommandRegistry({
        allowedCommands: allowedRootCommands,
        parent,
        path: root ? [] : [plugin.id],
        pluginId: plugin.id,
        resolveContext: this.#resolveContext,
      });
      plugin.registerCommands(registry);
      if (registry.size === 0) {
        throw new Error(
          `PLUGIN_CONTRACT_INVALID: ${plugin.id}.registerCommands не зарегистрировал команды`,
        );
      }
      if (allowedRootCommands) {
        const missing = [...allowedRootCommands].filter((name) => !registry.list().includes(name));
        if (missing.length > 0) {
          throw new Error(
            `PLUGIN_CONTRACT_INVALID: ${plugin.id} не зарегистрировал root commands: ` +
              missing.join(", "),
          );
        }
      }
    }
    return program;
  }
}
