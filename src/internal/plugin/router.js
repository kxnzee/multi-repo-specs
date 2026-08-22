/** @fileoverview Routing нативных Plugin namespaces до Commander parsing. */

import process from "node:process";

import { runCommand } from "../shared/command.js";
import { findSpecRoot, readStoreConfiguration } from "../shared/store.js";
import { RESERVED_PLUGIN_IDS } from "./constants.js";
import { runPluginCommand } from "./project.js";

/** Извлекает обязательный `--repository` из native Plugin arguments. */
export function parseNativePluginArguments(args) {
  let repositoryId;
  const pluginArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repository") {
      if (repositoryId !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("Native Plugin command требует одно значение --repository <repository-id>");
      }
      repositoryId = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--repository=")) {
      if (repositoryId !== undefined || argument.slice("--repository=".length) === "") {
        throw new Error("Native Plugin command требует одно значение --repository <repository-id>");
      }
      repositoryId = argument.slice("--repository=".length);
    } else {
      pluginArgs.push(argument);
    }
  }
  if (!repositoryId) throw new Error("Native Plugin command требует --repository <repository-id>");
  return { repositoryId, pluginArgs };
}

/** Разрешает и выполняет первый token как project Plugin namespace. */
export async function routeNativePluginCommand(
  args,
  { cwd = process.cwd(), commandRunner = runCommand } = {},
) {
  const pluginId = args[0];
  if (!pluginId || pluginId.startsWith("-") || RESERVED_PLUGIN_IDS.has(pluginId)) return null;
  let storeRoot;
  try {
    storeRoot = await findSpecRoot(cwd);
  } catch (error) {
    if (error.code === "STORE_ROOT_NOT_FOUND") return null;
    throw error;
  }
  const { project } = await readStoreConfiguration(storeRoot);
  if (!project.hasPlugin(pluginId)) return null;
  const { repositoryId, pluginArgs } = parseNativePluginArguments(args.slice(1));
  const output = await runPluginCommand({
    storeRoot,
    pluginId,
    repositoryId,
    args: pluginArgs,
    commandRunner,
  });
  return { pluginId, repositoryId, output };
}
