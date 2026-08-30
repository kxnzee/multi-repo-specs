/** @fileoverview Минимальный источник Plugin package для bundled или npm install. */

import path from "node:path";
import process from "node:process";

const SOURCE_CONSTRUCTION = Symbol("PluginSource construction");

/** Завершает разбор стабильной ошибкой домена Plugin source. */
function invalid(message) {
  throw new Error(`PLUGIN_SOURCE_INVALID: ${message}`);
}

/** Не позволяет credential-bearing URL попасть в npm diagnostics. */
function assertNoCredentials(specifier) {
  let url;
  try {
    url = new URL(specifier.replace(/^git\+/, ""));
  } catch {
    return;
  }
  if (url.password || (["http:", "https:"].includes(url.protocol) && url.username)) {
    invalid("URL источника не должен содержать credentials");
  }
}

/** Immutable source: bundled package либо непрозрачный npm-compatible spec. */
export class PluginSource {
  #declaration;
  #installSpec;
  #kind;

  constructor({ declaration, installSpec, kind } = {}, token) {
    if (token !== SOURCE_CONSTRUCTION) {
      invalid("используйте PluginSource.parse или PluginSource.bundled");
    }
    this.#declaration = declaration;
    this.#installSpec = installSpec;
    this.#kind = kind;
    Object.freeze(this);
  }

  /** Передаёт package, Git, tarball или path в npm без собственной классификации. */
  static parse(specifier, { cwd = process.cwd() } = {}) {
    if (typeof specifier !== "string" || specifier.trim() !== specifier || !specifier) {
      invalid("source должен быть непустой строкой без внешних пробелов");
    }
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
      invalid("cwd должен быть абсолютным путём");
    }
    if (/[\r\n\0]/.test(specifier)) invalid("source должен быть однострочным");
    assertNoCredentials(specifier);
    const installSpec = specifier.startsWith(".")
      ? path.resolve(cwd, specifier)
      : specifier;
    return new PluginSource({
      declaration: specifier,
      installSpec,
      kind: "external",
    }, SOURCE_CONSTRUCTION);
  }

  /** Создаёт source для package, уже входящего в дистрибутив. */
  static bundled({ name, version } = {}) {
    if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
      invalid("bundled source требует package name и version");
    }
    const declaration = `${name}@${version}`;
    return new PluginSource({ declaration, installSpec: null, kind: "bundled" }, SOURCE_CONSTRUCTION);
  }

  get declaration() { return this.#declaration; }
  get installSpec() { return this.#installSpec; }
  get kind() { return this.#kind; }
  get installable() { return this.#kind === "external"; }
}
