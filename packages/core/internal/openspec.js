/** @fileoverview OpenSpec facade одного проверенного RepositoryCheckout. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { processes } from "./process.js";
import { CORE_SETTINGS } from "./settings.js";

/** Проверяет базовую JSON response и diagnostic errors OpenSpec. */
export function parseOpenSpecJson(source, command) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(
      `OpenSpec Orchestrator не может обработать ответ ${command}: ответ не является валидным JSON`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `OpenSpec Orchestrator не может обработать ответ ${command}: несовместимый базовый формат JSON response`,
    );
  }
  const errors = [];
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "status" && Array.isArray(item)) {
        for (const diagnostic of item) {
          if (
            !diagnostic ||
            typeof diagnostic !== "object" ||
            Array.isArray(diagnostic) ||
            !["info", "warning", "error"].includes(diagnostic.severity)
          ) {
            throw new Error(
              `OpenSpec Orchestrator не может обработать ответ ${command}: ` +
                "несовместимый формат diagnostic в status[]",
            );
          }
          if (diagnostic.severity === "error") errors.push(diagnostic);
        }
      } else visit(item);
    }
  };
  visit(value);
  if (errors.length > 0) {
    const details = errors.map(({ code, message }) => (
      `${code ? `${code}: ` : ""}${message ?? "неизвестная ошибка"}`
    )).join("; ");
    throw new Error(`${command} сообщила об ошибке: ${details}`);
  }
  return value;
}

/** Проверяет Store identity в JSON response. */
function assertStoreIdentity(store, expected, command) {
  if (!store || typeof store.id !== "string" || typeof store.root !== "string") {
    throw new Error(
      `OpenSpec Orchestrator не может обработать ответ ${command}: ` +
        "не передана обязательная identity Store (id, root)",
    );
  }
  if (store.id !== expected.id || path.resolve(store.root) !== expected.root) {
    throw new Error(
      `OpenSpec Orchestrator ожидал Store ${expected.id} по пути ${expected.root}, ` +
        `но ответ ${command} указал ${store.id} по пути ${store.root}`,
    );
  }
}

/** OpenSpec CLI, привязанный к одному Repository checkout. */
export class RepositoryOpenSpec {
  #scope;
  #process;

  constructor(scope, scopedProcess) {
    if (!scope || typeof scope.root !== "string" || scopedProcess?.cwd !== scope.root) {
      throw new Error("OPENSPEC_SCOPE_INVALID: scope и process должны иметь один canonical root");
    }
    this.#scope = scope;
    this.#process = scopedProcess;
    Object.freeze(this);
  }

  execute(args, options = {}) {
    return this.#process.run("openspec", args, options);
  }

  async version() {
    const version = (await this.execute(["--version"])).trim();
    if (!CORE_PATTERNS.semanticVersion.test(version)) {
      throw new Error(
        "OpenSpec Orchestrator не может определить версию OpenSpec CLI: " +
          "ожидалась semantic version",
      );
    }
    return version;
  }

  async registerStore() {
    this.#assertStoreScope();
    const args = [
      "store",
      "register",
      this.#scope.root,
      "--id",
      this.#scope.id,
      "--yes",
      "--json",
    ];
    const command = `openspec ${args.join(" ")}`;
    const result = parseOpenSpecJson(await this.execute(args), command);
    assertStoreIdentity(result.store, this.#scope, command);
  }

  async assertStoreHealthy() {
    this.#assertStoreScope();
    const args = ["store", "doctor", this.#scope.id, "--json"];
    const command = `openspec ${args.join(" ")}`;
    const result = parseOpenSpecJson(await this.execute(args), command);
    if (!Array.isArray(result.stores)) {
      throw new Error(`OpenSpec Orchestrator не может обработать ответ ${command}: отсутствует stores[]`);
    }
    const matching = result.stores.filter((store) => (
      store && typeof store === "object" && store.id === this.#scope.id
    ));
    if (matching.length !== 1) {
      throw new Error(
        `OpenSpec Orchestrator ожидал в ответе ${command} ровно один Store ` +
          `${this.#scope.id}, получено: ${matching.length}`,
      );
    }
    const [store] = matching;
    if (typeof store.root !== "string") {
      throw new Error(`OpenSpec Orchestrator не может обработать ответ ${command}: несовместимый Store`);
    }
    if (path.resolve(store.root) !== this.#scope.root) {
      throw new Error(
        `OpenSpec Orchestrator ожидал Store ${this.#scope.id} по пути ${this.#scope.root}, ` +
          `но ответ ${command} указал ${store.root}`,
      );
    }
    if (
      !store.metadata ||
      store.metadata.present !== true ||
      store.metadata.valid !== true ||
      !store.openspec_root ||
      store.openspec_root.healthy !== true
    ) {
      throw new Error(`Store ${this.#scope.id} не прошёл проверку здоровья ${command}`);
    }
    if (store.metadata.id !== undefined && store.metadata.id !== this.#scope.id) {
      throw new Error(
        `OpenSpec Orchestrator ожидал metadata.id ${this.#scope.id}, ` +
          `но ответ ${command} указал ${store.metadata.id}`,
      );
    }
  }

  async doctor(args = ["doctor"], onDiagnostic = () => {}) {
    const output = await this.execute(args, {
      environment: { NODE_NO_WARNINGS: "1" },
      onStderr: (message) => {
        const firstLine = message.split("\n")[0].trim();
        const severity = firstLine.startsWith("Using OpenSpec root:") ? "info" : "warning";
        onDiagnostic(message, severity);
      },
    });
    return output;
  }

  async assertContext({ storeId, storeRoot, source, storeOption = false }) {
    const args = storeOption
      ? ["context", "--store", storeId, "--json"]
      : ["context", "--json"];
    const command = `openspec ${args.join(" ")}`;
    const result = parseOpenSpecJson(await this.execute(args), command);
    const root = result.root;
    if (
      !root ||
      typeof root !== "object" ||
      typeof root.path !== "string" ||
      typeof root.source !== "string"
    ) {
      throw new Error(
        `OpenSpec Orchestrator не может обработать ответ ${command}: ` +
          "не передана обязательная identity OpenSpec root",
      );
    }
    if (path.resolve(root.path) !== storeRoot) {
      throw new Error(
        `OpenSpec Orchestrator ожидал root.path ${storeRoot}, ` +
          `но ответ ${command} указал ${root.path}`,
      );
    }
    if (root.source !== source) {
      throw new Error(
        `OpenSpec Orchestrator ожидал root.source ${source}, ` +
          `но ответ ${command} указал ${root.source}`,
      );
    }
    if (root.store_id !== storeId) {
      throw new Error(
        `OpenSpec Orchestrator ожидал root.store_id ${storeId}, ` +
          `но ответ ${command} указал ${root.store_id ?? "не указан"}`,
      );
    }
  }

  async assertStorePathAvailable() {
    this.#assertStoreScope();
    const args = ["store", "list", "--json"];
    const registry = parseOpenSpecJson(await this.execute(args), `openspec ${args.join(" ")}`);
    if (!Array.isArray(registry.stores)) {
      throw new Error("OpenSpec Orchestrator требует JSON capability: openspec store list --json: stores[]");
    }
    const registrations = registry.stores.filter(
      (store) => store &&
        typeof store === "object" &&
        typeof store.root === "string" &&
        path.resolve(store.root) === this.#scope.root,
    );
    if (registrations.length === 0) return;
    const registeredIds = registrations.map(({ id }) => id);
    if (registeredIds.some((id) => typeof id !== "string" || !CORE_PATTERNS.id.test(id))) {
      throw new Error("Некорректный Store ID в локальном registry OpenSpec");
    }
    const commands = registeredIds
      .map((registeredId) => `openspec store unregister ${registeredId}`)
      .join("\n");
    throw new Error(
      `Локальный registry OpenSpec уже регистрирует путь ${this.#scope.root} как Store: ` +
        `${registeredIds.join(", ")}. Для чистого первого запуска выполните:\n${commands}\n` +
        "Команда unregister удаляет только локальную регистрацию и не удаляет файлы. " +
        "После этого повторите openspec-orch init",
    );
  }

  async installAgentPack(agentAdapter) {
    this.#assertStoreScope();
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-openspec-profile-"));
    try {
      await fs.mkdir(path.join(configRoot, CORE_FILES.openSpecDirectory), { recursive: true });
      await fs.writeFile(
        path.join(configRoot, CORE_FILES.openSpecProfileConfig),
        `${JSON.stringify({
          profile: CORE_SETTINGS.openSpec.init.profile,
          delivery: CORE_SETTINGS.openSpec.init.delivery,
          workflows: CORE_SETTINGS.openSpec.init.workflows,
        }, null, 2)}\n`,
        "utf8",
      );
      await this.execute([
        "init",
        this.#scope.root,
        "--tools",
        agentAdapter,
        "--profile",
        CORE_SETTINGS.openSpec.init.profile,
        "--no-animation",
      ], { environment: { XDG_CONFIG_HOME: configRoot } });
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  }

  async setupStore(remote) {
    this.#assertStoreScope();
    const args = [
      "store",
      "setup",
      this.#scope.id,
      "--path",
      this.#scope.root,
      "--no-init-git",
      "--remote",
      remote,
      "--json",
    ];
    const result = parseOpenSpecJson(
      await this.execute(args, { sensitiveValues: [remote] }),
      `openspec store setup ${this.#scope.id}`,
    );
    assertStoreIdentity(
      result.store,
      this.#scope,
      `openspec store setup ${this.#scope.id}`,
    );
  }

  #assertStoreScope() {
    if (this.#scope.role !== "store" || typeof this.#scope.id !== "string") {
      throw new Error("OPENSPEC_SCOPE_INVALID: операция требует Store scope");
    }
  }
}

/** Factory ограниченных OpenSpec facades. */
export class OpenSpecService {
  #processService;

  constructor(processService = processes) {
    this.#processService = processService;
    Object.freeze(this);
  }

  forRepository(checkout) {
    return new RepositoryOpenSpec(checkout, this.#processService.forRepository(checkout));
  }

  forStoreTarget(target) {
    return new RepositoryOpenSpec(target, this.#processService.forStoreTarget(target));
  }
}

/** Общий OpenSpecService нового Core. */
export const openspec = Object.freeze(new OpenSpecService());
