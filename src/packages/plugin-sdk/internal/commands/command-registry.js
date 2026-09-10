/** @fileoverview Построение и проверка grammar Plugin command contribution. */

import {
  COMMAND_CONTEXT,
  COMMAND_PATTERNS,
} from "../constants.js";

const CONTEXT_KEYS = new Set(COMMAND_CONTEXT.keys);
const CONTEXT_SCOPES = new Set(COMMAND_CONTEXT.scopes);
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Creates one stable execution error. */
export function invalid(message, code = "PLUGIN_EXEC_COMMAND_INVALID") {
  throw Object.assign(new Error(`PLUGIN_EXEC_COMMAND_INVALID: ${message}`), { code });
}

/** Converts a kebab-case long option to its command action property. */
function optionKey(name) {
  return name.replace(/-([a-z0-9])/gu, (_match, character) => character.toUpperCase());
}

/** Parses `<arg>`, `[arg]`, `<args...>` or `[args...]`. */
function argumentDefinition(value, commandPath) {
  const match = value.match(/^(<|\[)([^>\]]+)(>|\])$/u);
  if (!match || (match[1] === "<" && match[3] !== ">") ||
    (match[1] === "[" && match[3] !== "]")) {
    invalid(`command '${commandPath}' содержит неверный argument '${value}'`);
  }
  const variadic = match[2].endsWith("...");
  const name = variadic ? match[2].slice(0, -3) : match[2];
  if (!OPTION_NAME_PATTERN.test(name)) {
    invalid(`command '${commandPath}' содержит неверное имя argument '${name}'`);
  }
  return Object.freeze({ name, required: match[1] === "<", variadic });
}

/** Parses one SDK command definition into an immutable node header. */
function commandDefinition(definition) {
  if (typeof definition !== "string" || definition.trim().length === 0) {
    invalid("command definition должна быть непустой строкой");
  }
  const parts = definition.trim().split(/\s+/u);
  const name = parts.shift();
  if (!COMMAND_PATTERNS.name.test(name)) {
    invalid(`command '${definition.trim()}' должна начинаться с kebab-case name`);
  }
  const args = parts.map((part) => argumentDefinition(part, definition.trim()));
  const variadicIndex = args.findIndex(({ variadic }) => variadic);
  if (variadicIndex !== -1 && variadicIndex !== args.length - 1) {
    invalid(`command '${definition.trim()}' содержит не последний variadic argument`);
  }
  let optionalSeen = false;
  for (const argument of args) {
    if (!argument.required) optionalSeen = true;
    if (optionalSeen && argument.required) {
      invalid(`command '${definition.trim()}' содержит required argument после optional`);
    }
  }
  return Object.freeze({ args: Object.freeze(args), definition: definition.trim(), name });
}

/** Parses the public option flags supported by the SDK builder. */
function optionDefinition(flags, description, { choices, parser, required = false } = {}) {
  if (typeof flags !== "string" || typeof description !== "string" || description.trim() === "") {
    invalid("option требует flags и description");
  }
  const long = flags.match(/--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\s+(<[^>]+>|\[[^\]]+\]))?/u);
  const short = flags.match(/(?:^|,\s*)-([a-zA-Z])(?=,|\s|$)/u)?.[1];
  if (!long) invalid(`option '${flags}' не содержит long flag`);
  const value = long[2];
  const takesValue = value !== undefined;
  const valueRequired = value?.startsWith("<") ?? false;
  if (choices !== undefined && (
    !Array.isArray(choices) ||
    choices.length === 0 ||
    choices.some((choice) => typeof choice !== "string" || choice.length === 0) ||
    new Set(choices).size !== choices.length
  )) {
    invalid(`option '${flags}' содержит неверные choices`);
  }
  if (parser !== undefined && typeof parser !== "function") {
    invalid(`option '${flags}' содержит неверный parser`);
  }
  if (typeof required !== "boolean") invalid(`option '${flags}' содержит неверный required`);
  return Object.freeze({
    choices: choices === undefined ? undefined : Object.freeze([...choices]),
    description,
    flags,
    key: optionKey(long[1]),
    long: long[1],
    parser,
    required,
    short,
    takesValue,
    valueRequired,
  });
}

/** Mutable registration node kept private until one execution. */
function commandNode(parsed) {
  return {
    action: undefined,
    args: parsed.args,
    commands: new Map(),
    definition: parsed.definition,
    description: "",
    name: parsed.name,
    options: [],
  };
}

/** SDK command builder backed by an isolated in-memory grammar. */
class ExecutionCommandBuilder {
  #context;
  #node;
  #path;

  constructor(node, context, commandPath) {
    this.#node = node;
    this.#context = context;
    this.#path = Object.freeze([...commandPath]);
  }

  description(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      invalid(`command '${this.#path.join(" ")}' description пуст`);
    }
    this.#node.description = value;
    return this;
  }

  action(handler) {
    this.#setAction(handler, { context: false, scope: COMMAND_CONTEXT.defaultScope });
    return this;
  }

  actionWithContext(handler, config = {}) {
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some((key) => !CONTEXT_KEYS.has(key))
    ) {
      invalid("context config должен быть object");
    }
    const scope = config.scope ?? COMMAND_CONTEXT.defaultScope;
    if (!CONTEXT_SCOPES.has(scope)) invalid("context scope должен быть current или store");
    if (config.requireBinding !== undefined && typeof config.requireBinding !== "boolean") {
      invalid("requireBinding должен быть boolean");
    }
    this.#setAction(handler, { context: true, scope });
    return this;
  }

  command(definition) {
    const parsed = commandDefinition(definition);
    const fullPath = [...this.#path, parsed.name].join(" ");
    if (this.#node.commands.has(parsed.name)) {
      invalid(`повторяется command path '${fullPath}'`);
    }
    const child = commandNode(parsed);
    this.#node.commands.set(parsed.name, child);
    return new ExecutionCommandBuilder(child, this.#context, [...this.#path, parsed.name]);
  }

  option(flags, description, config = {}) {
    const option = optionDefinition(flags, description, config);
    if (this.#node.options.some(({ long, short }) => (
      long === option.long || (short !== undefined && short === option.short)
    ))) {
      invalid(`command '${this.#path.join(" ")}' повторяет option '${flags}'`);
    }
    this.#node.options.push(option);
    return this;
  }

  #setAction(handler, metadata) {
    if (typeof handler !== "function") invalid(`command '${this.#path.join(" ")}' action не функция`);
    if (this.#node.action) invalid(`command '${this.#path.join(" ")}' повторяет action`);
    this.#node.action = Object.freeze({ ...metadata, handler, pluginContext: this.#context });
  }
}

/** Root registry for one Plugin command contribution. */
class ExecutionCommandRegistry {
  #commands = new Map();
  #context;

  constructor(context) {
    this.#context = context;
  }

  command(definition) {
    const parsed = commandDefinition(definition);
    if (this.#commands.has(parsed.name)) invalid(`повторяется command path '${parsed.name}'`);
    const node = commandNode(parsed);
    this.#commands.set(parsed.name, node);
    return new ExecutionCommandBuilder(node, this.#context, [parsed.name]);
  }

  get commands() {
    return this.#commands;
  }
}

/** Compiles the public builder once for runtime execution and contract inspection. */
export function compilePluginCommands(registerCommands, context) {
  if (typeof registerCommands !== "function") invalid("требуется registerCommands");
  const registry = new ExecutionCommandRegistry(context);
  registerCommands(registry);
  return registry.commands;
}

/** Verifies the exact runtime grammar without invoking any registered action. */
export function inspectPluginCommands(registerCommands) {
  try {
    const commands = compilePluginCommands(registerCommands, undefined);
    if (commands.size === 0) invalid("registerCommands не добавил команды");
    const verify = (node, commandPath) => {
      if (!node.description) invalid(`command '${commandPath}' не имеет description`);
      if (!node.action && node.commands.size === 0) {
        invalid(`command '${commandPath}' не имеет action`);
      }
      for (const child of node.commands.values()) verify(child, `${commandPath} ${child.name}`);
    };
    for (const node of commands.values()) verify(node, node.name);
    return Object.freeze([...commands.keys()]);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/^PLUGIN_EXEC_COMMAND_INVALID:\s*/u, "");
    throw new Error(`PLUGIN_CONTRACT_INVALID: ${message}`, { cause: error });
  }
}
