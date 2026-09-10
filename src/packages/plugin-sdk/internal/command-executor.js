
/** @fileoverview Разбор argv и выполнение заранее проверенной Plugin command grammar. */

import { COMMAND_SCOPE, REPOSITORY_ROLE } from "./constants.js";
import { compilePluginCommands, invalid } from "./commands/command-registry.js";
import {
  parseCommandArgs,
  positionalValues,
  printHelp,
  selectCommand,
} from "./commands/command-parser.js";

export { compilePluginCommands, inspectPluginCommands } from "./commands/command-registry.js";
/** Executes argv against the Plugin's own registered command grammar. */
export function executePluginCommands(registerCommands, context, args) {
  if (!context || typeof context !== "object") invalid("требуется PluginContext");
  if (!Array.isArray(args) || args.length === 0 || args.some((value) => typeof value !== "string")) {
    throw new Error("PLUGIN_EXEC_INVALID: args должен быть непустым массивом строк");
  }

  const commands = compilePluginCommands(registerCommands, context);
  if (commands.size === 0) {
    invalid("registerCommands не добавил команды", "PLUGIN_EXEC_COMMAND_UNKNOWN");
  }
  const selected = selectCommand(commands, args);
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
