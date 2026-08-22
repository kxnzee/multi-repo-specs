/** @fileoverview Низкоуровневый исполнитель подготовленного Plugin invocation. */

import { runCommand } from "../shared/command.js";
import { resolvePluginInvocation } from "./runtime.js";

export class PluginClient {
  #cwd;
  #pluginPackage;
  #runner;

  constructor(cwd, commandRunner, pluginPackage) {
    this.#cwd = cwd;
    this.#pluginPackage = pluginPackage;
    this.#runner = commandRunner;
  }

  /** Выполняет подготовленный доменной моделью invocation без shell. */
  execute(invocation) {
    const { command, args } = resolvePluginInvocation(this.#pluginPackage, invocation);
    return this.#runner(
      command,
      args,
      { cwd: this.#cwd },
    );
  }
}

/** Создаёт Plugin client, привязанный к одному Repository. */
export function createPluginClient(cwd, commandRunner = runCommand, pluginPackage) {
  return new PluginClient(cwd, commandRunner, pluginPackage);
}
