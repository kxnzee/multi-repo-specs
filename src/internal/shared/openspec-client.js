/** @fileoverview Низкоуровневый исполнитель OpenSpec CLI в фиксированном cwd. */

import { runCommand } from "./command.js";

export class OpenSpecClient {
  #cwd;
  #runner;

  constructor(cwd, commandRunner) {
    this.#cwd = cwd;
    this.#runner = commandRunner;
  }

  /** Выполняет OpenSpec без shell, не интерпретируя результат команды. */
  execute(args, options = {}) {
    return this.#runner("openspec", args, { ...options, cwd: this.#cwd });
  }
}

/** Создаёт OpenSpec client, привязанный к одному рабочему каталогу. */
export function createOpenSpecClient(cwd, commandRunner = runCommand) {
  return new OpenSpecClient(cwd, commandRunner);
}
