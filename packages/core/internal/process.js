/** @fileoverview Безопасный запуск внешних CLI в доменно ограниченном cwd. */

import { execa } from "execa";

import { CORE_SETTINGS } from "./settings.js";
import { StoreTarget } from "./store-target.js";

const COMMAND_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});

/** Скрывает чувствительные значения в диагностике внешней команды. */
function redact(value, sensitiveValues) {
  let result = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive) result = result.split(sensitive).join("<repository-url>");
  }
  return result;
}

/** Исполнитель, уже привязанный к Repository или Workspace root. */
export class ScopedProcess {
  #cwd;
  #executor;

  constructor(cwd, executor) {
    this.#cwd = cwd;
    this.#executor = executor;
    Object.freeze(this);
  }

  get cwd() {
    return this.#cwd;
  }

  async run(
    executable,
    args,
    {
      environment = {},
      onStderr = () => {},
      sensitiveValues = [],
      timeout = CORE_SETTINGS.execution.externalCommandTimeoutMs,
      acceptedExitCodes = [0],
    } = {},
  ) {
    if (typeof executable !== "string" || executable.length === 0 || executable.startsWith("-")) {
      throw new Error("Executable внешней команды некорректен");
    }
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
      throw new Error("Аргументы внешней команды должны быть массивом строк");
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new Error("Timeout внешней команды должен быть положительным числом");
    }
    if (
      !Array.isArray(acceptedExitCodes) || acceptedExitCodes.length === 0 ||
      acceptedExitCodes.some((code) => !Number.isInteger(code) || code < 0)
    ) {
      throw new Error("acceptedExitCodes должен быть непустым массивом exit codes");
    }
    const result = await this.#executor(executable, args, {
      cwd: this.#cwd,
      env: { ...environment, ...COMMAND_ENV },
      reject: false,
      timeout,
    });
    if (result.failed && !acceptedExitCodes.includes(result.exitCode)) {
      const invocation = redact(`${executable} ${args.join(" ")}`, sensitiveValues);
      const details = redact(
        [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
        sensitiveValues,
      );
      const reason = result.timedOut
        ? `превысила timeout ${timeout} мс`
        : result.signal
          ? `завершена сигналом ${result.signal}`
          : result.exitCode === undefined
            ? `не запущена: ${result.originalMessage ?? result.shortMessage}`
            : "завершилась с ошибкой";
      throw new Error(
        `${invocation} ${redact(reason, sensitiveValues)}${details ? `:\n${details}` : ""}`,
      );
    }
    const warning = redact(result.stderr.trim(), sensitiveValues);
    if (warning) onStderr(warning);
    return result.stdout;
  }
}

/** Factory доменно ограниченных process executors. */
export class ProcessService {
  #executor;

  constructor(executor = execa) {
    this.#executor = executor;
    Object.freeze(this);
  }

  forRepository(checkout) {
    return new ScopedProcess(checkout.root, this.#executor);
  }

  forStoreTarget(target) {
    if (!(target instanceof StoreTarget)) {
      throw new Error("PROCESS_SCOPE_INVALID: требуется StoreTarget");
    }
    return new ScopedProcess(target.root, this.#executor);
  }

  forWorkspace(workspace) {
    return new ScopedProcess(workspace.root, this.#executor);
  }
}

/** Общий ProcessService нового Core. */
export const processes = Object.freeze(new ProcessService());
