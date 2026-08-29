/** @fileoverview Dependency-free argv executor for one Plugin command contribution. */

import {
  COMMAND_CONTEXT,
  COMMAND_PATTERNS,
  COMMAND_SCOPE,
  REPOSITORY_ROLE,
} from "./constants.js";

const CONTEXT_KEYS = new Set(COMMAND_CONTEXT.keys);
const CONTEXT_SCOPES = new Set(COMMAND_CONTEXT.scopes);
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Creates one stable execution error. */
function invalid(message) {
  throw new Error(`PLUGIN_EXEC_COMMAND_INVALID: ${message}`);
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

/** Resolves a long or short option token for one leaf command. */
function resolveOption(node, token) {
  const longMatch = token.match(/^--([a-z][a-z0-9-]*)(?:=(.*))?$/u);
  if (longMatch) {
    return {
      inlineValue: longMatch[2],
      option: node.options.find(({ long }) => long === longMatch[1]),
    };
  }
  const shortMatch = token.match(/^-([a-zA-Z])$/u);
  if (shortMatch) {
    return { option: node.options.find(({ short }) => short === shortMatch[1]) };
  }
  return undefined;
}

/** Applies one parsed option value to the action options object. */
function applyOption(option, rawValue, options) {
  if (!option) invalid("получена неизвестная option");
  if (!option.takesValue) {
    if (rawValue !== undefined) invalid(`--${option.long} не принимает значение`);
    options[option.key] = true;
    return;
  }
  if (rawValue === undefined) {
    if (option.valueRequired) invalid(`--${option.long} требует значение`);
    options[option.key] = true;
    return;
  }
  if (option.choices && !option.choices.includes(rawValue)) {
    invalid(`--${option.long} принимает: ${option.choices.join(", ")}`);
  }
  try {
    options[option.key] = option.parser
      ? option.parser(rawValue, options[option.key])
      : rawValue;
  } catch (error) {
    invalid(error instanceof Error ? error.message : String(error));
  }
}

/** Separates options from positional argv for one selected command. */
function parseCommandArgs(node, argv) {
  const options = {};
  const positional = [];
  let optionMode = true;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (optionMode && token === "--") {
      optionMode = false;
      continue;
    }
    const resolved = optionMode && token.startsWith("-") ? resolveOption(node, token) : undefined;
    if (!resolved) {
      if (optionMode && token.startsWith("-")) invalid(`неизвестная option '${token}'`);
      positional.push(token);
      continue;
    }
    if (!resolved.option) invalid(`неизвестная option '${token}'`);
    let value = resolved.inlineValue;
    if (resolved.option.takesValue && value === undefined) {
      const candidate = argv[index + 1];
      if (candidate !== undefined && (!candidate.startsWith("-") || resolved.option.valueRequired)) {
        value = candidate;
        index += 1;
      }
    }
    applyOption(resolved.option, value, options);
  }
  for (const option of node.options) {
    if (option.required && options[option.key] === undefined) {
      invalid(`обязательна option --${option.long}`);
    }
  }
  return Object.freeze({ options: Object.freeze(options), positional: Object.freeze(positional) });
}

/** Converts positional argv to the action signature declared in the command definition. */
function positionalValues(node, positional) {
  const values = [];
  let index = 0;
  for (const argument of node.args) {
    if (argument.variadic) {
      const rest = positional.slice(index);
      if (argument.required && rest.length === 0) invalid(`требуется argument <${argument.name}...>`);
      values.push(Object.freeze(rest));
      index = positional.length;
      continue;
    }
    const value = positional[index];
    if (value === undefined && argument.required) invalid(`требуется argument <${argument.name}>`);
    values.push(value);
    if (value !== undefined) index += 1;
  }
  if (index < positional.length) invalid(`лишние arguments: ${positional.slice(index).join(" ")}`);
  return values;
}

/** Prints minimal help for an isolated Plugin command path. */
function printHelp(node, commandPath) {
  const lines = [`Usage: plugin-exec ${commandPath.join(" ")}`];
  if (node.description) lines.push("", node.description);
  if (node.commands.size > 0) {
    lines.push("", "Commands:");
    for (const child of node.commands.values()) {
      lines.push(`  ${child.definition}  ${child.description}`.trimEnd());
    }
  }
  if (node.options.length > 0) {
    lines.push("", "Options:");
    for (const option of node.options) lines.push(`  ${option.flags}  ${option.description}`);
  }
  console.log(lines.join("\n"));
}

/** Selects one command node before parsing its action argv. */
function selectCommand(commands, args) {
  const first = args[0];
  let node = commands.get(first);
  if (!node) invalid(`неизвестная command '${first ?? ""}'`);
  const path = [first];
  let index = 1;
  while (node.commands.has(args[index])) {
    node = node.commands.get(args[index]);
    path.push(args[index]);
    index += 1;
  }
  return Object.freeze({ argv: args.slice(index), node, path: Object.freeze(path) });
}

/** Executes argv against the Plugin's own registered command grammar. */
export async function executePluginCommands(registerCommands, context, args) {
  if (typeof registerCommands !== "function") invalid("требуется registerCommands");
  if (!context || typeof context !== "object") invalid("требуется PluginContext");
  if (!Array.isArray(args) || args.length === 0 || args.some((value) => typeof value !== "string")) {
    throw new Error("PLUGIN_EXEC_INVALID: args должен быть непустым массивом строк");
  }

  const registry = new ExecutionCommandRegistry(context);
  registerCommands(registry);
  if (registry.commands.size === 0) invalid("registerCommands не добавил команды");
  const selected = selectCommand(registry.commands, args);
  if (selected.argv.includes("--help") || selected.argv.includes("-h")) {
    printHelp(selected.node, selected.path);
    return;
  }
  if (!selected.node.action) {
    invalid(`command '${selected.path.join(" ")}' требует вложенную command`);
  }
  const parsed = parseCommandArgs(selected.node, selected.argv);
  const values = positionalValues(selected.node, parsed.positional);
  const action = selected.node.action;
  if (
    action.context &&
    action.scope === COMMAND_SCOPE.store &&
    context.repository?.role !== REPOSITORY_ROLE.store
  ) {
    throw new Error(
      `PLUGIN_EXEC_SCOPE_MISMATCH: ${selected.path.join(" ")} требует Store instance`,
    );
  }
  return action.context
    ? action.handler(action.pluginContext, ...values, parsed.options)
    : action.handler(...values, parsed.options);
}
