/** @fileoverview Подключение рабочей машины к Store и постоянному multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  assertSupportedOpenSpecVersion,
  parseSddConfig,
  parseStoreMetadata,
  sameGitRemote,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";
import {
  assertOpenSpecRoot,
  parseOpenSpecJson,
} from "../shared/openspec.js";

const REQUIRED_AGENT_COMMANDS = Object.freeze([
  "opsx-explore.md",
  "sdd-context.md",
]);
const GIT_POINTER_PATH = "openspec/config.yaml";
const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  sddConfig: "sdd.yaml",
  openSpec: "openspec",
  pointer: path.join("openspec", "config.yaml"),
});

/**
 * Запись Code Repository из нормализованного sdd.yaml.
 *
 * @typedef {object} CodeRepository
 * @property {string} id Устойчивый repository-id.
 * @property {string} url Канонический Git URL.
 * @property {string} defaultBranch Основная ветка.
 */

/**
 * Результат подключения одного Code Repository.
 *
 * @typedef {object} ConnectedRepository
 * @property {string} id Устойчивый repository-id.
 * @property {string} path Абсолютный путь checkout.
 * @property {string} branch Проверенная текущая ветка.
 * @property {string} revision Текущая Git-ревизия.
 * @property {boolean} cloned Был ли checkout создан текущим вызовом.
 * @property {boolean} pointerCreated Был ли создан openspec/config.yaml.
 * @property {boolean} pointerPending Есть ли непринятое изменение pointer в Git.
 * @property {"ready" | "needs_setup_pr"} status Локальный статус подключения.
 */

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние пути либо `null` для ENOENT.
 */
async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Читает обязательный обычный файл внутри заданного корня.
 *
 * @param {string} root Абсолютный корень проекта.
 * @param {string} relativePath Относительный путь обязательного файла.
 * @returns {Promise<string>} UTF-8 содержимое файла.
 */
async function readFile(root, relativePath) {
  const target = path.join(root, relativePath);
  const stat = await pathState(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Отсутствует обычный файл ${relativePath}`);
  }
  return fs.readFile(target, "utf8");
}

/**
 * Запускает OpenSpec через переданный runner и разбирает его JSON-ответ.
 *
 * @param {typeof runCommand} commandRunner Исполнитель внешних команд.
 * @param {string[]} args Аргументы OpenSpec без имени executable.
 * @param {string} cwd Рабочий каталог команды.
 * @returns {Record<string, any>} Проверенный JSON-ответ OpenSpec.
 */
function runOpenSpecJson(commandRunner, args, cwd) {
  const command = `openspec ${args.join(" ")}`;
  return parseOpenSpecJson(commandRunner("openspec", args, { cwd }), command);
}

/**
 * Проверяет Store ID и путь в ответе одной официальной команды OpenSpec.
 *
 * @param {Record<string, any>} payload JSON-ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} storeRoot Ожидаемый абсолютный путь Store.
 * @param {string} command Название команды для ошибки.
 * @returns {void}
 */
function assertStoreIdentity(payload, storeId, storeRoot, command) {
  if (payload.store?.id !== storeId || path.resolve(payload.store?.root ?? "") !== storeRoot) {
    throw new Error(`${command} вернула другой Store`);
  }
}

/**
 * Проверяет полный результат `openspec store doctor` для подключаемого Store.
 *
 * @param {Record<string, any>} payload JSON-ответ store doctor.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} storeRoot Ожидаемый абсолютный путь Store.
 * @returns {void}
 */
function validateStoreDoctor(payload, storeId, storeRoot) {
  const stores = Array.isArray(payload.stores)
    ? payload.stores.filter(({ id }) => id === storeId)
    : [];
  if (stores.length !== 1) {
    throw new Error(`openspec store doctor не вернула ровно один Store ${storeId}`);
  }
  const store = stores[0];
  if (path.resolve(store.root ?? "") !== storeRoot) {
    throw new Error(`openspec store doctor вернула другой путь Store: ${store.root ?? "не указан"}`);
  }
  if (store.metadata?.present !== true || store.metadata?.valid !== true) {
    throw new Error("openspec store doctor не подтвердила валидную Store metadata");
  }
  if (store.metadata.id !== undefined && store.metadata.id !== storeId) {
    throw new Error(`openspec store doctor вернула другой Store ID: ${store.metadata.id}`);
  }
  if (store.openspec_root?.healthy !== true) {
    throw new Error("openspec store doctor не подтвердила исправный OpenSpec root");
  }
}

/**
 * Проверяет существующий checkout без fetch/pull и других изменений Git.
 *
 * @param {string} repositoryRoot
 * @param {CodeRepository} repository
 * @param {typeof runCommand} commandRunner
 * @returns {{branch: string, revision: string}}
 */
function inspectCheckout(repositoryRoot, repository, commandRunner) {
  const gitRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }),
  );
  if (gitRoot !== repositoryRoot) {
    throw new Error(`${repository.id}: каталог не является корнем Git-репозитория`);
  }
  const origin = commandRunner("git", ["remote", "get-url", "origin"], {
    cwd: repositoryRoot,
  });
  if (!sameGitRemote(origin, repository.url)) {
    throw new Error(`${repository.id}: origin не совпадает с sdd.yaml`);
  }
  const branch = commandRunner("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
  });
  if (branch !== repository.defaultBranch) {
    throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  }
  const changes = commandRunner(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  // Porcelain всегда использует Git-пути с `/`, в том числе на Windows.
  const unexpectedChanges = changes.filter((line) => line.slice(3) !== GIT_POINTER_PATH);
  if (unexpectedChanges.length > 0) {
    throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  }
  return {
    branch,
    revision: commandRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
  };
}

/**
 * Создаёт или проверяет минимальный OpenSpec pointer. Локальные specs/changes намеренно
 * блокируют действие: их перенос в Store требует отдельного решения человека.
 *
 * @param {string} repositoryRoot
 * @param {string} storeId
 * @returns {Promise<boolean>} true, если pointer был создан.
 */
async function ensurePointer(repositoryRoot, storeId) {
  const openSpecRoot = path.join(repositoryRoot, PATHS.openSpec);
  for (const directory of ["specs", "changes"]) {
    if (await pathState(path.join(openSpecRoot, directory))) {
      throw new Error(
        `${repositoryRoot} содержит локальный openspec/${directory}; требуется отдельная миграция`,
      );
    }
  }

  const pointerPath = path.join(repositoryRoot, PATHS.pointer);
  const pointerStat = await pathState(pointerPath);
  if (!pointerStat) {
    await fs.mkdir(openSpecRoot, { recursive: true });
    await fs.writeFile(pointerPath, `store: ${storeId}\n`, "utf8");
    return true;
  }
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${PATHS.pointer} должна быть обычным файлом`);
  }
  if ((await fs.readFile(pointerPath, "utf8")).replaceAll("\r\n", "\n") !== `store: ${storeId}\n`) {
    throw new Error(`${PATHS.pointer} должна содержать только 'store: ${storeId}'`);
  }
  return false;
}

/**
 * Определяет общий workspace по стандартной раскладке или явному аргументу.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string | undefined} requestedWorkspace Явно переданный workspace.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
async function resolveWorkspace(storeRoot, requestedWorkspace) {
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : path.basename(path.dirname(storeRoot)) === "openspec"
      ? path.dirname(path.dirname(storeRoot))
      : null;
  if (!workspace) {
    throw new Error(
      "Не удалось определить workspace; разместите Store в <workspace>/openspec/ или передайте --workspace",
    );
  }
  const stat = await pathState(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}

/**
 * Клонирует отсутствующий code-репозиторий или только валидирует существующий.
 *
 * @param {object} options
 * @param {CodeRepository} options.repository Запись репозитория из sdd.yaml.
 * @param {string} options.sourceRoot Каталог `<workspace>/src`.
 * @param {string} options.storeId ID центрального Store.
 * @param {string} options.storeRoot Абсолютный путь центрального Store.
 * @param {typeof runCommand} options.commandRunner Исполнитель внешних команд.
 * @returns {Promise<ConnectedRepository>} Проверенное локальное подключение репозитория.
 */
async function connectRepository({ repository, sourceRoot, storeId, storeRoot, commandRunner }) {
  const repositoryRoot = path.join(sourceRoot, repository.id);
  const existing = await pathState(repositoryRoot);
  let cloned = false;
  if (!existing) {
    commandRunner(
      "git",
      [
        "clone",
        "--single-branch",
        "--no-tags",
        "--branch",
        repository.defaultBranch,
        "--",
        repository.url,
        repositoryRoot,
      ],
      { cwd: sourceRoot, sensitiveValues: [repository.url] },
    );
    cloned = true;
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
  }

  const git = inspectCheckout(repositoryRoot, repository, commandRunner);
  const pointerCreated = await ensurePointer(repositoryRoot, storeId);
  const pointerPending = Boolean(
    commandRunner(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", GIT_POINTER_PATH],
      { cwd: repositoryRoot },
    ),
  );
  const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], repositoryRoot);
  assertOpenSpecRoot(
    doctor.root,
    { path: storeRoot, storeId, source: "declared" },
    "openspec doctor --json",
  );
  if (doctor.root.healthy !== true) {
    throw new Error(`${repository.id}: openspec doctor не подтвердила исправный Store`);
  }
  const context = runOpenSpecJson(commandRunner, ["context", "--json"], repositoryRoot);
  assertOpenSpecRoot(
    context.root,
    { path: storeRoot, storeId, source: "declared" },
    "openspec context --json",
  );
  return {
    id: repository.id,
    path: repositoryRoot,
    branch: git.branch,
    revision: git.revision,
    cloned,
    pointerCreated,
    pointerPending,
    status: pointerPending ? "needs_setup_pr" : "ready",
  };
}

/**
 * Подключает текущий компьютер к готовому Store и собирает локальный workspace.
 * OpenSpec отвечает за register/doctor, адаптер — за раскладку репозиториев и
 * минимальный pointer в каждом code-репозитории.
 *
 * @param {object} [options]
 * @param {string} [options.start] Корень центрального Store-репозитория.
 * @param {string} [options.workspace] Корень workspace; обычно определяется автоматически.
 * @param {typeof runCommand} [options.commandRunner] Переопределяется только в тестах.
 * @returns {Promise<{
 *   storeId: string,
 *   storeRoot: string,
 *   workspace: string,
 *   status: "ready" | "needs_setup_pr",
 *   repositories: ConnectedRepository[]
 * }>}
 */
export async function connectProject({
  start = process.cwd(),
  workspace: requestedWorkspace,
  commandRunner = runCommand,
} = {}) {
  const storeRoot = await fs.realpath(path.resolve(start));
  const metadata = parseStoreMetadata(await readFile(storeRoot, PATHS.metadata));
  const config = parseSddConfig(await readFile(storeRoot, PATHS.sddConfig));

  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в sdd.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  assertSupportedOpenSpecVersion(config.openSpecVersion);
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: storeRoot });
  if (installedVersion !== config.openSpecVersion) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${config.openSpecVersion}`);
  }

  for (const command of REQUIRED_AGENT_COMMANDS) {
    await readFile(storeRoot, path.join(config.agent.commandsDirectory, command));
  }

  // Не дублируем правила Store: официальный CLI является источником ошибок.
  const registration = runOpenSpecJson(
    commandRunner,
    ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"],
    storeRoot,
  );
  assertStoreIdentity(registration, metadata.id, storeRoot, "openspec store register");

  const storeDoctor = runOpenSpecJson(
    commandRunner,
    ["store", "doctor", metadata.id, "--json"],
    storeRoot,
  );
  validateStoreDoctor(storeDoctor, metadata.id, storeRoot);

  const doctor = runOpenSpecJson(
    commandRunner,
    ["doctor", "--store", metadata.id, "--json"],
    storeRoot,
  );
  assertOpenSpecRoot(
    doctor.root,
    { path: storeRoot, storeId: metadata.id, source: "store" },
    `openspec doctor --store ${metadata.id} --json`,
  );
  if (doctor.root.healthy !== true || doctor.store?.id !== metadata.id) {
    throw new Error("openspec doctor не подтвердила исправный зарегистрированный Store");
  }

  const context = runOpenSpecJson(
    commandRunner,
    ["context", "--store", metadata.id, "--json"],
    storeRoot,
  );
  assertOpenSpecRoot(
    context.root,
    { path: storeRoot, storeId: metadata.id, source: "store" },
    `openspec context --store ${metadata.id} --json`,
  );

  const workspace = await resolveWorkspace(storeRoot, requestedWorkspace);
  const sourceRoot = path.join(workspace, "src");
  await fs.mkdir(sourceRoot, { recursive: true });

  const repositories = [];
  for (const repository of config.codeRepositories) {
    repositories.push(
      await connectRepository({
        repository,
        sourceRoot,
        storeId: metadata.id,
        storeRoot,
        commandRunner,
      }),
    );
  }

  return {
    storeId: metadata.id,
    storeRoot,
    workspace,
    status: repositories.some(({ pointerPending }) => pointerPending)
      ? "needs_setup_pr"
      : "ready",
    repositories,
  };
}
