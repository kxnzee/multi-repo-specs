/** @fileoverview Единственная execution boundary для npm package operations. */

import path from "node:path";
import process from "node:process";

import { execa } from "execa";

import { CORE_SETTINGS } from "./settings.js";
import { redactSensitive } from "./process.js";

const NPM_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
});

/** Hides common npm credentials even when a registry echoes its request URL. */
function sanitize(value, sensitiveValues = []) {
  const withoutAuth = value.replace(
    /((?:https?:\/\/))[^\s/@]+@/giu,
    "$1<redacted>@",
  );
  return redactSensitive(withoutAuth, [
    process.env.NODE_AUTH_TOKEN,
    process.env.NPM_TOKEN,
    ...sensitiveValues,
  ]).replace(/(_authToken\s*=\s*)[^\s]+/giu, "$1<redacted>");
}

/** Завершает operation стабильной ошибкой npm boundary. */
function invalid(message) {
  throw new Error(`NPM_PACKAGE_INVALID: ${message}`);
}

/** Запускает npm без shell, lifecycle scripts и интерактивных prompt. */
export class NpmPackageInstaller {
  #environment;
  #executor;
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
    this.#environment = Object.freeze({ ...environment });
    this.#executor = executor;
    this.#timeout = timeout;
    Object.freeze(this);
  }

  install({ runtimeRoot, source } = {}) {
    if (typeof source !== "string" || !source) invalid("source должен быть непустой строкой");
    return this.#run(runtimeRoot, ["install", "--save-exact", "--install-links", "--", source]);
  }

  remove({ packageName, runtimeRoot } = {}) {
    if (typeof packageName !== "string" || !packageName) {
      invalid("packageName должен быть непустой строкой");
    }
    return this.#run(runtimeRoot, ["uninstall", "--", packageName]);
  }

  sync({ runtimeRoot } = {}) {
    return this.#run(runtimeRoot, ["ci", "--install-links"]);
  }

  async #run(runtimeRoot, command) {
    if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot)) {
      invalid("runtimeRoot должен быть абсолютным путём");
    }
    const args = [
      command[0],
      "--prefix", runtimeRoot,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...command.slice(1),
    ];
    let result;
    const sensitiveValues = Object.entries(this.#environment)
      .filter(([key]) => /(?:auth|password|secret|token)/iu.test(key))
      .map(([, value]) => value);
    try {
      result = await this.#executor("npm", args, {
        cwd: runtimeRoot,
        env: { ...this.#environment, ...NPM_ENV },
        reject: false,
        shell: false,
        stdin: "ignore",
        timeout: this.#timeout,
      });
    } catch (cause) {
      throw new Error(
        `NPM_PACKAGE_FAILED: npm не запущен: ${sanitize(cause.message, sensitiveValues)}`,
        { cause },
      );
    }
    if (result.failed) {
      const details = sanitize(
        [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
        sensitiveValues,
      );
      const reason = result.timedOut
        ? `превышен timeout ${this.#timeout} мс`
        : result.signal
          ? `процесс завершён сигналом ${result.signal}`
          : `npm завершился с кодом ${result.exitCode ?? "unknown"}`;
      throw new Error(`NPM_PACKAGE_FAILED: ${reason}${details ? `:\n${details}` : ""}`);
    }
    return result.stdout ?? "";
  }
}

export const npmPackageInstaller = Object.freeze(new NpmPackageInstaller());
