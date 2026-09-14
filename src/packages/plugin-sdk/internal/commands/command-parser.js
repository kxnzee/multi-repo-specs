
/** @fileoverview Разбор argv одной уже выбранной Plugin command. */

import { invalid } from "./command-registry.js";

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
export function parseCommandArgs(node, argv) {
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
      const candidateIsOption = candidate === "--" || resolveOption(node, candidate ?? "") !== undefined;
      if (candidate !== undefined && !candidateIsOption) {
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
export function positionalValues(node, positional) {
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
export function printHelp(node, commandPath) {
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
export function selectCommand(commands, args) {
  const first = args[0];
  let node = commands.get(first);
  if (!node) invalid(`неизвестная command '${first ?? ""}'`, "PLUGIN_EXEC_COMMAND_UNKNOWN");
  const path = [first];
  let index = 1;
  while (node.commands.has(args[index])) {
    node = node.commands.get(args[index]);
    path.push(args[index]);
    index += 1;
  }
  return Object.freeze({ argv: args.slice(index), node, path: Object.freeze(path) });
}
