/** @fileoverview OpenSpec facade одного проверенного RepositoryCheckout. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { processes } from "./process.js";
import { CORE_SETTINGS } from "./settings.js";

const OPEN_SPEC_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Rejects values that could alter the fixed OpenSpec argv grammar. */
function assertOpenSpecIdentifier(value, label) {
  if (typeof value !== "string" || !OPEN_SPEC_IDENTIFIER.test(value)) {
    throw new Error(`OPENSPEC_INPUT_INVALID: ${label} должен быть lowercase kebab-case`);
  }
}

/** Checks only schema-declared prerequisites for the built-in Apply action. */
function applyPrerequisitesComplete(status, artifacts) {
  const applyRequires = Array.isArray(status.applyRequires) ? new Set(status.applyRequires) : null;
  return status.isPlanningComplete === true || (
    applyRequires && [...applyRequires].every((id) => artifacts.some((artifact) => (
      artifact.id === id && ["done", "skipped"].includes(artifact.status)
    )))
  );
}

/** Interprets schema-aware Apply progress without reading task files in Core. */
function applyProgressState(instructions) {
  const progress = instructions?.progress;
  if (
    !progress || typeof progress !== "object" || Array.isArray(progress) ||
    ![progress.total, progress.complete, progress.remaining].every(Number.isInteger) ||
    progress.total <= 0 || progress.complete < 0 || progress.remaining < 0 ||
    progress.complete + progress.remaining !== progress.total
  ) {
    return "unknown";
  }
  if (instructions.state === "ready" && progress.remaining > 0) return "pending";
  if (instructions.state === "all_done" && progress.remaining === 0) return "complete";
  return "unknown";
}

/** Interprets only stable OpenSpec artifact and Apply status vocabularies. */
function nextArtifactAction(status, changeId, applyInstructions) {
  if (!Array.isArray(status.artifacts)) {
    return Object.freeze({
      action: "consult_change_context",
      actor: "agent",
      reason: "OpenSpec status не содержит artifact graph для автоматической маршрутизации",
      change_id: changeId,
    });
  }
  const artifacts = status.artifacts.filter((artifact) => (
    artifact && typeof artifact === "object" && !Array.isArray(artifact) &&
    typeof artifact.id === "string" && typeof artifact.status === "string"
  ));
  if (artifacts.length !== status.artifacts.length) {
    return Object.freeze({
      action: "consult_change_context",
      actor: "agent",
      reason: "OpenSpec status содержит несовместимый artifact graph",
      change_id: changeId,
    });
  }
  const ready = artifacts.filter(({ status: value }) => value === "ready");
  const planningComplete = applyPrerequisitesComplete(status, artifacts);
  if (ready.length > 0 && planningComplete && applyInstructions !== undefined) {
    const progressState = applyProgressState(applyInstructions);
    if (progressState === "pending") {
      return Object.freeze({
        action: "apply_change",
        actor: "agent",
        reason: "OpenSpec сообщил о незавершённых Apply tasks",
        change_id: changeId,
      });
    }
    if (progressState === "unknown") {
      return Object.freeze({
        action: "consult_change_context",
        actor: "agent",
        reason: "OpenSpec не сообщил однозначный прогресс Apply",
        change_id: changeId,
      });
    }
  }
  if (ready.length === 1) {
    return Object.freeze({
      action: "prepare_artifact",
      actor: "agent",
      reason: "OpenSpec разблокировал следующий artifact",
      change_id: changeId,
      artifact: ready[0].id,
    });
  }
  if (ready.length > 1) {
    return Object.freeze({
      action: "choose_ready_artifact",
      actor: "human",
      reason: "OpenSpec допускает несколько следующих artifacts; выбор не должен быть угадан",
      change_id: changeId,
      artifacts: Object.freeze(ready.map(({ id }) => id)),
    });
  }
  const blocked = artifacts.filter(({ status: value }) => value === "blocked");
  if (blocked.length > 0) {
    return Object.freeze({
      action: "resolve_artifact_blocker",
      actor: "human",
      reason: "OpenSpec artifact graph содержит заблокированные artifacts",
      change_id: changeId,
      artifacts: Object.freeze(blocked.map(({ id }) => id)),
    });
  }
  return Object.freeze({
    action: planningComplete ? "apply_change" : "consult_change_context",
    actor: "agent",
    reason: planningComplete
      ? "OpenSpec подтвердил готовность Planning prerequisites для Apply"
      : "OpenSpec не объявил однозначный следующий artifact",
    change_id: changeId,
  });
}

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

  /** Reads the exact machine-readable list used by Agent and CLI application adapters. */
  async listChanges() {
    const args = ["list", "--json"];
    return parseOpenSpecJson(await this.execute(args), `openspec ${args.join(" ")}`);
  }

  /** Reads one current Change status without interpreting schema-specific workflow. */
  async changeStatus(changeId) {
    assertOpenSpecIdentifier(changeId, "change-id");
    const args = ["status", "--change", changeId, "--json"];
    return parseOpenSpecJson(await this.execute(args), `openspec ${args.join(" ")}`);
  }

  /** Reads canonical schema instructions for one exact Change artifact. */
  async artifactInstructions(changeId, artifact) {
    assertOpenSpecIdentifier(changeId, "change-id");
    assertOpenSpecIdentifier(artifact, "artifact");
    const args = ["instructions", artifact, "--change", changeId, "--json"];
    return parseOpenSpecJson(await this.execute(args), `openspec ${args.join(" ")}`);
  }

  /** Derives a conservative read-only recommendation from canonical OpenSpec status. */
  async nextAction(changeId) {
    assertOpenSpecIdentifier(changeId, "change-id");
    const status = await this.changeStatus(changeId);
    const candidate = nextArtifactAction(status, changeId);
    if (
      !["prepare_artifact", "choose_ready_artifact"].includes(candidate.action) ||
      !Array.isArray(status.artifacts) ||
      !applyPrerequisitesComplete(status, status.artifacts)
    ) {
      return candidate;
    }
    const applyInstructions = await this.artifactInstructions(changeId, "apply");
    return nextArtifactAction(status, changeId, applyInstructions);
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
