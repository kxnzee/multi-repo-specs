/** @fileoverview OpenSpec facade одного проверенного RepositoryCheckout. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CORE_FILES, CORE_PATTERNS } from "../configuration/constants.js";
import { nextOpenSpecAction, requiresApplyInstructions } from "./openspec-next-action.js";
import { processes } from "../infrastructure/process.js";
import { CORE_SETTINGS } from "../configuration/settings.js";
import {
  collectOpenSpecDiagnostics,
  parseOpenSpecDocument,
  parseOpenSpecJson,
} from "./openspec-response.js";
import { files } from "../infrastructure/files.js";

const OPEN_SPEC_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TASK_LINE_PATTERN = /^(\s*[-*]\s*\[)([\sxX])(\]\s*)(.*)/u;

/** Rejects values that could alter the fixed OpenSpec argv grammar. */
function assertOpenSpecIdentifier(value, label) {
  if (typeof value !== "string" || !OPEN_SPEC_IDENTIFIER.test(value)) {
    throw new Error(`OPENSPEC_INPUT_INVALID: ${label} должен быть lowercase kebab-case`);
  }
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

/** Validates the stable Apply task fields needed for one guarded checkbox update. */
function applyTaskContext(value, changeId) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.changeName !== changeId || !Array.isArray(value.tasks) ||
    value.tasks.some((task) => (
      !task || typeof task !== "object" || Array.isArray(task) ||
      typeof task.id !== "string" || !task.id ||
      typeof task.description !== "string" || !task.description.trim() ||
      typeof task.done !== "boolean"
    )) || new Set(value.tasks.map(({ id }) => id)).size !== value.tasks.length
  ) {
    throw new Error("OPENSPEC_TASK_CONTEXT_INVALID: Apply не содержит однозначный список задач");
  }
  const taskFiles = value.contextFiles?.tasks;
  if (!Array.isArray(taskFiles) || taskFiles.length !== 1 || typeof taskFiles[0] !== "string") {
    throw new Error("OPENSPEC_TASK_CONTEXT_INVALID: ожидается один contextFiles.tasks");
  }
  const progress = value.progress;
  if (
    !progress || typeof progress !== "object" || Array.isArray(progress) ||
    ![progress.total, progress.complete, progress.remaining].every(Number.isInteger) ||
    progress.total < value.tasks.length || progress.complete < 0 || progress.remaining < 0 ||
    progress.complete + progress.remaining !== progress.total
  ) {
    throw new Error("OPENSPEC_TASK_CONTEXT_INVALID: Apply progress противоречив");
  }
  return { progress, taskFile: taskFiles[0], tasks: value.tasks };
}

/** Resolves one OpenSpec-reported task file back into the scoped Store facade. */
function taskFileRelativePath(root, taskFile) {
  const absolute = path.resolve(root, taskFile);
  const relative = path.relative(root, absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("OPENSPEC_TASK_CONTEXT_INVALID: tasks file выходит за Store root");
  }
  return relative.split(path.sep).join("/");
}

/** Changes only the checkbox marker selected by OpenSpec's opaque task ID. */
function updateTaskMarker(source, expectedTask, completed) {
  if (typeof source !== "string") {
    throw new Error("OPENSPEC_TASK_CONTEXT_INVALID: tasks file отсутствует");
  }
  const parts = source.split(/(\r?\n)/u);
  let taskIndex = 0;
  let matched = false;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const match = TASK_LINE_PATTERN.exec(line);
    if (!match || !match[4].trim()) continue;
    taskIndex += 1;
    if (`${taskIndex}` !== expectedTask.id) continue;
    const description = match[4].trim();
    const current = match[2].toLowerCase() === "x";
    if (description !== expectedTask.description || current !== expectedTask.done) {
      throw new Error("OPENSPEC_TASK_CONFLICT: задача изменилась после чтения Apply-контекста");
    }
    parts[index] = `${match[1]}${completed ? "x" : " "}${line.slice(match[1].length + 1)}`;
    matched = true;
    break;
  }
  if (!matched) {
    throw new Error("OPENSPEC_TASK_CONFLICT: task_id не соответствует текущему tasks file");
  }
  return parts.join("");
}

/** OpenSpec CLI, привязанный к одному Repository checkout. */
export class RepositoryOpenSpec {
  #files;
  #scope;
  #process;

  constructor(scope, scopedProcess, scopedFiles = null) {
    if (!scope || typeof scope.root !== "string" || scopedProcess?.cwd !== scope.root) {
      throw new Error("OPENSPEC_SCOPE_INVALID: scope и process должны иметь один canonical root");
    }
    this.#scope = scope;
    this.#process = scopedProcess;
    this.#files = scopedFiles;
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
    const jsonArgs = args.includes("--json") ? args : [...args, "--json"];
    const command = `openspec ${jsonArgs.join(" ")}`;
    const output = await this.execute(jsonArgs, {
      environment: { NODE_NO_WARNINGS: "1" },
      onStderr: (message) => onDiagnostic(message, "warning"),
    });
    const document = parseOpenSpecDocument(output, command);
    for (const diagnostic of collectOpenSpecDiagnostics(document, command)) {
      const message = `${diagnostic.code ? `${diagnostic.code}: ` : ""}` +
        `${diagnostic.message ?? "неизвестная диагностика"}`;
      onDiagnostic(message, diagnostic.severity === "info" ? "info" : "warning");
    }
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

  /** Atomically records one exact OpenSpec task result in the owning Store. */
  async setTaskCompletion(changeId, taskId, completed) {
    this.#assertStoreScope();
    assertOpenSpecIdentifier(changeId, "change-id");
    if (typeof taskId !== "string" || !taskId) {
      throw new Error("OPENSPEC_INPUT_INVALID: task-id должен быть непустой строкой");
    }
    if (typeof completed !== "boolean") {
      throw new Error("OPENSPEC_INPUT_INVALID: completed должен быть boolean");
    }
    if (!this.#files || typeof this.#files.update !== "function") {
      throw new Error("OPENSPEC_TASK_UPDATE_UNAVAILABLE: Store files facade недоступен");
    }
    const before = applyTaskContext(await this.artifactInstructions(changeId, "apply"), changeId);
    const task = before.tasks.find(({ id }) => id === taskId);
    if (!task) throw new Error(`OPENSPEC_TASK_NOT_FOUND: ${changeId}: ${taskId}`);
    if (task.done === completed) {
      return Object.freeze({
        change_id: changeId, task_id: taskId, completed, changed: false,
        progress: Object.freeze({ ...before.progress }),
      });
    }
    const relativePath = taskFileRelativePath(this.#scope.root, before.taskFile);
    await this.#files.update(relativePath, (source) => updateTaskMarker(source, task, completed));
    const after = applyTaskContext(await this.artifactInstructions(changeId, "apply"), changeId);
    const updated = after.tasks.find(({ id }) => id === taskId);
    if (!updated || updated.description !== task.description || updated.done !== completed) {
      throw new Error("OPENSPEC_TASK_UPDATE_INVALID: OpenSpec не подтвердил обновлённую задачу");
    }
    return Object.freeze({
      change_id: changeId, task_id: taskId, completed, changed: true,
      progress: Object.freeze({ ...after.progress }),
    });
  }

  /** Derives a conservative read-only recommendation from canonical OpenSpec status. */
  async nextAction(changeId) {
    assertOpenSpecIdentifier(changeId, "change-id");
    const status = await this.changeStatus(changeId);
    const candidate = nextOpenSpecAction(status, changeId);
    if (!requiresApplyInstructions(status, candidate)) {
      return candidate;
    }
    const applyInstructions = await this.artifactInstructions(changeId, "apply");
    return nextOpenSpecAction(status, changeId, applyInstructions);
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
    const registrations = registry.stores.filter((store) => (
      store &&
      typeof store === "object" &&
      (
        store.id === this.#scope.id ||
        (typeof store.root === "string" && path.resolve(store.root) === this.#scope.root)
      )
    ));
    if (registrations.length === 0) return;
    const registeredIds = [...new Set(registrations.map(({ id }) => id))];
    if (registeredIds.some((id) => typeof id !== "string" || !CORE_PATTERNS.id.test(id))) {
      throw new Error("Некорректный Store ID в локальном registry OpenSpec");
    }
    const commands = registeredIds
      .map((registeredId) => `openspec store unregister ${registeredId}`)
      .join("\n");
    throw new Error(
      `Локальный registry OpenSpec уже содержит Store ID ${this.#scope.id} или путь ` +
        `${this.#scope.root}: ${registeredIds.join(", ")}. ` +
        `Для чистого первого запуска выполните:\n${commands}\n` +
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
        "--force",
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
      ...(remote ? ["--remote", remote] : []),
      "--json",
    ];
    const result = parseOpenSpecJson(
      await this.execute(args, { sensitiveValues: remote ? [remote] : [] }),
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
  #fileService;
  #processService;

  constructor(processService = processes, fileService = files) {
    this.#processService = processService;
    this.#fileService = fileService;
    Object.freeze(this);
  }

  forRepository(checkout) {
    return new RepositoryOpenSpec(
      checkout,
      this.#processService.forRepository(checkout),
      this.#fileService.forRepository(checkout),
    );
  }

  forStoreTarget(target) {
    return new RepositoryOpenSpec(target, this.#processService.forStoreTarget(target));
  }
}

/** Общий OpenSpecService нового Core. */
export const openspec = Object.freeze(new OpenSpecService());

export { parseOpenSpecJson };
