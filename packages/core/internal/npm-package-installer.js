/** @fileoverview Безопасная npm execution boundary для materialization Plugin package. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";

import { CORE_SETTINGS } from "./settings.js";
import { PluginSource } from "./plugin-source.js";

const NPM_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
});

/** Завершает операцию стабильной ошибкой npm installer. */
function invalid(message, options) {
  throw new Error(`PLUGIN_INSTALL_INVALID: ${message}`, options);
}

/** Проверяет и канонизирует заранее созданный временный runtime. */
async function resolveRuntimeRoot(runtimeRoot) {
  if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot)) {
    invalid("runtimeRoot должен быть абсолютным путём");
  }
  let stat;
  try {
    stat = await fs.lstat(runtimeRoot);
  } catch (error) {
    if (error.code === "ENOENT") invalid("runtimeRoot не существует", { cause: error });
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    invalid("runtimeRoot должен быть обычным каталогом");
  }
  return fs.realpath(runtimeRoot);
}

/** Результат одного успешного npm materialization. */
export class NpmPackageInstallResult {
  #runtimeRoot;
  #source;
  #stdout;

  constructor({ runtimeRoot, source, stdout }) {
    if (
      typeof runtimeRoot !== "string" ||
      !path.isAbsolute(runtimeRoot) ||
      !(source instanceof PluginSource) ||
      typeof stdout !== "string"
    ) {
      invalid("результат npm install некорректен");
    }
    this.#runtimeRoot = runtimeRoot;
    this.#source = source;
    this.#stdout = stdout;
    Object.freeze(this);
  }

  get runtimeRoot() { return this.#runtimeRoot; }
  get source() { return this.#source; }
  get stdout() { return this.#stdout; }
}

/** Выполняет только npm install; temp runtime и activation принадлежат Plugin Manager. */
export class NpmPackageInstaller {
  #executor;
  #environment;
  #timeout;

  constructor({
    environment = {},
    executor = execa,
    timeout = CORE_SETTINGS.execution.externalCommandTimeoutMs,
  } = {}) {
    if (typeof executor !== "function") invalid("executor должен быть функцией");
    if (
      !environment ||
      typeof environment !== "object" ||
      Array.isArray(environment) ||
      Object.values(environment).some((value) => typeof value !== "string")
    ) {
      invalid("environment должен содержать только строковые значения");
    }
    if (!Number.isFinite(timeout) || timeout <= 0) invalid("timeout должен быть положительным");
    this.#executor = executor;
    this.#environment = Object.freeze({ ...environment });
    this.#timeout = timeout;
    Object.freeze(this);
  }

  /** Materialize один installable source в существующий временный runtime. */
  async install({ source, runtimeRoot } = {}) {
    if (!(source instanceof PluginSource) || !source.installable) {
      invalid("требуется installable PluginSource");
    }
    const root = await resolveRuntimeRoot(runtimeRoot);
    const args = [
      "install",
      "--prefix", root,
      "--save-exact",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--install-links",
    ];
    args.push("--", source.installSpec);
    let result;
    try {
      result = await this.#executor("npm", args, {
        cwd: root,
        env: { ...this.#environment, ...NPM_ENV },
        reject: false,
        shell: false,
        stdin: "ignore",
        timeout: this.#timeout,
      });
    } catch (error) {
      throw new Error(`PLUGIN_INSTALL_FAILED: npm не запущен: ${error.message}`, { cause: error });
    }
    if (result.failed) {
      const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      const reason = result.timedOut
        ? `превышен timeout ${this.#timeout} мс`
        : result.signal
          ? `процесс завершён сигналом ${result.signal}`
          : `npm завершился с кодом ${result.exitCode ?? "unknown"}`;
      throw new Error(`PLUGIN_INSTALL_FAILED: ${reason}${details ? `:\n${details}` : ""}`);
    }
    return new NpmPackageInstallResult({
      runtimeRoot: root,
      source,
      stdout: result.stdout ?? "",
    });
  }
}

/** Общая npm execution boundary нового Core. */
export const npmPackageInstaller = Object.freeze(new NpmPackageInstaller());
