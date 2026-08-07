/** @fileoverview Read-only предпроверки Store и выбранных репозиториев для шага Explore. */

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

export { parseSddConfig } from "../config/index.js";
export { runCommand } from "../shared/command.js";

const TEXT_ENCODING = "utf8";
const ARCHIVE_PREFIX = /^\d{4}-\d{2}-\d{2}-(.+)$/;
const TICKET_PATTERN = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Репозиторий из нормализованного sdd.yaml.
 *
 * @typedef {object} RegisteredRepository
 * @property {string} id Устойчивый repository-id.
 * @property {string} url Канонический Git URL.
 * @property {string} defaultBranch Основная ветка.
 */

/**
 * Зарегистрированный Code Repository с разрешённым локальным checkout.
 *
 * @typedef {RegisteredRepository & {path: string}} ResolvedRepository
 */

/**
 * Зафиксированное состояние чистого и свежего Git checkout.
 *
 * @typedef {object} GitState
 * @property {string} branch Проверенная текущая ветка.
 * @property {string} revision Точная 40-символьная Git-ревизия.
 */

/**
 * Проверенный технический вход агентского Explore.
 *
 * @typedef {object} ExplorePreparation
 * @property {string} ticket Jira ticket key.
 * @property {string} projectRoot Абсолютный путь центрального Store.
 * @property {string} storeRepositoryId ID центрального Store Repository.
 * @property {GitState} store Зафиксированное Git-состояние Store.
 * @property {string} workspace Абсолютный путь multi-repo workspace.
 * @property {boolean} projectSpecsOnly Выполняется ли Explore без Code Repositories.
 * @property {Array<{id: string, path: string, branch: string, revision: string}>} repositories
 * Выбранные и проверенные Code Repositories.
 */

const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  sddConfig: "sdd.yaml",
  openSpecConfig: path.join("openspec", "config.yaml"),
  openSpecContextStart: path.join("openspec", "context", "00-start-here.md"),
  openSpecSystemMap: path.join("openspec", "context", "system-map.yaml"),
  archive: path.join("openspec", "changes", "archive"),
});

const REQUIRED_ROOT_PATHS = Object.freeze([
  PATHS.metadata,
  PATHS.sddConfig,
  PATHS.openSpecConfig,
  PATHS.openSpecContextStart,
  PATHS.openSpecSystemMap,
]);

const EXPLORE_ACTION = Object.freeze({
  invocation: "/opsx-explore",
  introduction: "Это Explore шага 01 SDD.",
  instructions: Object.freeze([
    "Работай только на чтение: не создавай Change, OpenSpec-артефакты, TODO, ADR, ветку или PR и не изменяй context pack, Master Specs либо код.",
    "Ticket и исходное намерение бери только из этой команды; не начинай исследование по предыдущим сообщениям сессии.",
    "Если исходного намерения недостаточно для начала исследования, задай уточняющий вопрос до чтения кода. Уточнённую проблему и ожидаемый наблюдаемый результат сформулируй по исследованным фактам.",
    "Workspace задаёт multi-repo-территорию, но не является разрешением сканировать её целиком: читай только явно перечисленные корни. Не читай родительские каталоги, remotes, невыбранные репозитории и другие соседние пути.",
    "Не обращайся к Jira API.",
    "Все непосредственные чтения specs и Changes выполняй с явным --store для указанного Store ID; не используй nearest или default Store.",
    `Прочитай ${PATHS.openSpecContextStart}, назначенный им контекст и подходящие Master Specs; для каждого checkout проверь ветку, точную ревизию и чистоту до и после исследования.`,
    "Не выдавай предполагаемые endpoint, технологии, статусы и архитектуру за текущее состояние. Каждый факт свяжи с прочитанным источником; неподтверждённое явно пометь как гипотезу или неизвестное.",
    "Верни структурированный итог: ticket, исходное намерение, уточнённая проблема, ожидаемый наблюдаемый результат, прочитанные источники, исследованные репозитории и ревизии, текущее поведение, область влияния, альтернативы, факты и источники, предположения, открытые вопросы с владельцами и признаком блокировки.",
    "Если нужен ещё один Code Repository, остановись и попроси повторить sdd explore с полным набором.",
  ]),
});

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
 * Проверяет, что путь указывает на обычный файл, а не на symlink.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<boolean>} `true` только для существующего обычного файла.
 */
async function isFile(target) {
  const stat = await pathState(target);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
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
 * Подтверждает, что найденный Store содержит обязательный SDD skeleton.
 *
 * @param {string} candidate Предполагаемый корень центрального Store.
 * @returns {Promise<string>} Канонический абсолютный путь Store.
 */
async function requireProjectRoot(candidate) {
  const matches = await Promise.all(
    REQUIRED_ROOT_PATHS.map((relativePath) => isFile(path.join(candidate, relativePath))),
  );
  if (!matches.every(Boolean)) {
    throw new Error(`Разрешённый Store не содержит обязательный SDD skeleton: ${candidate}`);
  }
  return fs.realpath(candidate);
}

/**
 * Находит центральный Store только среди текущего каталога и его родителей.
 *
 * @param {string} [start] Начальный файл или каталог поиска.
 * @returns {Promise<string>} Канонический абсолютный путь найденного Store.
 */
export async function findSpecRoot(start = process.cwd()) {
  let candidate = path.resolve(start);
  const initial = await pathState(candidate);
  if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
  if (!initial.isDirectory()) candidate = path.dirname(candidate);

  while (true) {
    const matches = await Promise.all(
      REQUIRED_ROOT_PATHS.map((relativePath) => isFile(path.join(candidate, relativePath))),
    );
    if (matches.every(Boolean)) return fs.realpath(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("Не удалось найти Spec Root среди родителей текущего каталога");
}

/**
 * Разрешает запуск из центрального Store или подключённого Code Repository.
 *
 * @param {string} start Начальный путь пользователя.
 * @param {typeof runCommand} commandRunner Исполнитель Git и OpenSpec.
 * @returns {Promise<{
 *   projectRoot: string,
 *   codeRoot: string | null,
 *   discovery: null | {doctor: Record<string, any>, context: Record<string, any>}
 * }>} Разрешённый Store и сведения запуска из Code Repository.
 */
async function resolveStart(start, commandRunner) {
  try {
    return { projectRoot: await findSpecRoot(start), codeRoot: null, discovery: null };
  } catch (nearestError) {
    let cwd = path.resolve(start);
    const stat = await pathState(cwd);
    if (!stat) throw nearestError;
    if (!stat.isDirectory()) cwd = path.dirname(cwd);

    const codeRoot = path.resolve(
      commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd }),
    );
    const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], codeRoot);
    const context = runOpenSpecJson(commandRunner, ["context", "--json"], codeRoot);
    if (doctor.root?.source !== "declared" || context.root?.source !== "declared") {
      throw new Error("Code Repository не разрешил Store через project pointer");
    }
    const projectRoot = await requireProjectRoot(path.resolve(context.root.path ?? ""));
    return { projectRoot, codeRoot, discovery: { doctor, context } };
  }
}

/**
 * Определяет и проверяет общий корень постоянного multi-repo workspace.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string | undefined} requestedWorkspace Явно переданный workspace.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
async function resolveWorkspace(projectRoot, requestedWorkspace) {
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : path.basename(path.dirname(projectRoot)) === "openspec"
      ? path.dirname(path.dirname(projectRoot))
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
 * Проверяет наличие оригинальной команды `/opsx-explore` выбранного агента.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {{id: string, commandsDirectory: string, generatedDirectory: string | null}} agent
 * Сохранённая конфигурация agent adapter.
 * @returns {Promise<void>}
 */
async function validateOpenSpecAction(projectRoot, agent) {
  const relativePath = path.join(agent.commandsDirectory, "opsx-explore.md");
  if (!(await isFile(path.join(projectRoot, relativePath)))) {
    const recovery = agent.generatedDirectory
      ? `совместимый pack для ${agent.id} должен обновить Technical Owner через SDD adapter`
      : "выполните openspec update --force";
    throw new Error(`Не установлено оригинальное действие OpenSpec ${relativePath}; ${recovery}`);
  }
}

/**
 * Проверяет metadata, здоровье и регистрацию Store из ответа store doctor.
 *
 * @param {Record<string, any>} payload JSON-ответ OpenSpec.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @returns {void}
 */
function assertStoreDoctor(payload, storeId, projectRoot) {
  const stores = Array.isArray(payload.stores)
    ? payload.stores.filter(({ id }) => id === storeId)
    : [];
  if (stores.length !== 1) {
    throw new Error(`openspec store doctor не вернула ровно один Store ${storeId}`);
  }
  const store = stores[0];
  if (path.resolve(store.root ?? "") !== projectRoot) {
    throw new Error(`Store ${storeId} зарегистрирован по другому пути: ${store.root ?? "не указан"}`);
  }
  if (
    store.metadata?.present !== true ||
    store.metadata?.valid !== true ||
    store.openspec_root?.healthy !== true
  ) {
    throw new Error(`openspec store doctor не подтвердила исправный Store ${storeId}`);
  }
}

/**
 * Подтверждает, что команда list прочитала ожидаемый Store root.
 *
 * @param {Record<string, any>} payload JSON-ответ `openspec list`.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} command Название команды для ошибки.
 * @returns {void}
 */
function assertListRoot(payload, projectRoot, storeId, command) {
  assertOpenSpecRoot(payload.root, { path: projectRoot, storeId, source: "store" }, command);
}

/**
 * Выполняет полный набор предпроверок OpenSpec перед Explore.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} configuredVersion Закреплённая версия OpenSpec из sdd.yaml.
 * @param {typeof runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Array<{name: string}>} Активные Changes из разрешённого Store.
 */
function validateOpenSpec(projectRoot, storeId, configuredVersion, commandRunner) {
  assertSupportedOpenSpecVersion(configuredVersion);
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: projectRoot });
  if (installedVersion !== configuredVersion) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${configuredVersion}`);
  }

  const storeList = runOpenSpecJson(commandRunner, ["store", "list", "--json"], projectRoot);
  const registrations = Array.isArray(storeList.stores)
    ? storeList.stores.filter(({ id }) => id === storeId)
    : [];
  if (
    registrations.length !== 1 ||
    path.resolve(registrations[0].root ?? "") !== projectRoot
  ) {
    throw new Error(`Store ${storeId} не зарегистрирован по ожидаемому пути ${projectRoot}`);
  }

  const storeDoctor = runOpenSpecJson(
    commandRunner,
    ["store", "doctor", storeId, "--json"],
    projectRoot,
  );
  assertStoreDoctor(storeDoctor, storeId, projectRoot);

  const doctorCommand = `openspec doctor --store ${storeId} --json`;
  const doctor = runOpenSpecJson(
    commandRunner,
    ["doctor", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(doctor.root, { path: projectRoot, storeId, source: "store" }, doctorCommand);
  if (doctor.root.healthy !== true || doctor.store?.id !== storeId) {
    throw new Error(`${doctorCommand} не подтвердила исправный Store`);
  }

  const contextCommand = `openspec context --store ${storeId} --json`;
  const context = runOpenSpecJson(
    commandRunner,
    ["context", "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(context.root, { path: projectRoot, storeId, source: "store" }, contextCommand);

  const specs = runOpenSpecJson(
    commandRunner,
    ["list", "--specs", "--store", storeId, "--json"],
    projectRoot,
  );
  if (!Array.isArray(specs.specs)) throw new Error("openspec list --specs не вернула specs");
  assertListRoot(specs, projectRoot, storeId, "openspec list --specs");

  const changes = runOpenSpecJson(
    commandRunner,
    ["list", "--changes", "--store", storeId, "--json"],
    projectRoot,
  );
  if (!Array.isArray(changes.changes)) throw new Error("openspec list --changes не вернула Changes");
  assertListRoot(changes, projectRoot, storeId, "openspec list --changes");
  return changes.changes;
}

/**
 * Сверяет корень и origin локального checkout с записью `sdd.yaml`.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {RegisteredRepository} repository Ожидаемая identity репозитория.
 * @param {typeof runCommand} commandRunner Исполнитель Git.
 * @returns {void}
 */
function inspectRepositoryIdentity(repositoryRoot, repository, commandRunner) {
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
}

/**
 * Проверяет чистоту, ветку и свежесть Git checkout относительно origin.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {RegisteredRepository} repository Ожидаемая identity и основная ветка.
 * @param {typeof runCommand} commandRunner Исполнитель Git.
 * @returns {GitState} Проверенные ветка и точная ревизия.
 */
function inspectFreshCheckout(repositoryRoot, repository, commandRunner) {
  inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const changes = commandRunner(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  if (changes) throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  const branch = commandRunner("git", ["branch", "--show-current"], { cwd: repositoryRoot });
  if (branch !== repository.defaultBranch) {
    throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  }
  commandRunner("git", ["fetch", "origin", repository.defaultBranch], { cwd: repositoryRoot });
  const revision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const remoteRevision = commandRunner(
    "git",
    ["rev-parse", `origin/${repository.defaultBranch}`],
    { cwd: repositoryRoot },
  );
  if (!GIT_REVISION_PATTERN.test(revision) || !GIT_REVISION_PATTERN.test(remoteRevision)) {
    throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
  }
  if (revision !== remoteRevision) {
    throw new Error(`${repository.id}: checkout не совпадает с origin/${repository.defaultBranch}`);
  }
  return { branch, revision };
}

/**
 * Разрешает пути всех зарегистрированных Code Repositories в workspace.
 *
 * @param {string} workspace Абсолютный путь multi-repo workspace.
 * @param {RegisteredRepository[]} repositories Записи `role: code` из sdd.yaml.
 * @param {typeof runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<ResolvedRepository[]>} Репозитории с каноническими локальными путями.
 */
async function resolveCodeRepositories(workspace, repositories, commandRunner) {
  const sourceRoot = path.join(workspace, "src");
  const resolved = [];
  for (const repository of repositories) {
    const repositoryRoot = path.join(sourceRoot, repository.id);
    const stat = await pathState(repositoryRoot);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${repository.id}: отсутствует checkout ${repositoryRoot}; выполните sdd connect`);
    }
    const canonicalRoot = await fs.realpath(repositoryRoot);
    inspectRepositoryIdentity(canonicalRoot, repository, commandRunner);
    resolved.push({ ...repository, path: canonicalRoot });
  }
  return resolved;
}

/**
 * Проверяет config-only pointer Code Repository на тот же центральный Store.
 *
 * @param {ResolvedRepository} repository Проверяемый Code Repository.
 * @param {string} storeId Ожидаемый Store ID.
 * @param {string} projectRoot Ожидаемый абсолютный путь Store.
 * @param {typeof runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {Promise<void>}
 */
async function validatePointer(repository, storeId, projectRoot, commandRunner) {
  for (const directory of ["specs", "changes"]) {
    if (await pathState(path.join(repository.path, "openspec", directory))) {
      throw new Error(
        `${repository.id}: локальный openspec/${directory} запрещён в Code Repository`,
      );
    }
  }
  const pointerPath = path.join(repository.path, PATHS.openSpecConfig);
  if (!(await isFile(pointerPath))) {
    throw new Error(`${repository.id}: отсутствует принятый OpenSpec pointer; выполните sdd connect`);
  }
  const pointer = (await fs.readFile(pointerPath, TEXT_ENCODING)).replaceAll("\r\n", "\n");
  if (pointer !== `store: ${storeId}\n`) {
    throw new Error(`${repository.id}: openspec/config.yaml должен содержать только store: ${storeId}`);
  }

  const doctorCommand = "openspec doctor --json";
  const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], repository.path);
  assertOpenSpecRoot(
    doctor.root,
    { path: projectRoot, storeId, source: "declared" },
    doctorCommand,
  );
  if (doctor.root.healthy !== true) {
    throw new Error(`${repository.id}: OpenSpec root не прошёл doctor`);
  }

  const context = runOpenSpecJson(commandRunner, ["context", "--json"], repository.path);
  assertOpenSpecRoot(
    context.root,
    { path: projectRoot, storeId, source: "declared" },
    "openspec context --json",
  );
}

/**
 * Проверяет принадлежность имени Change указанному ticket по соглашению шага 01.
 *
 * @param {unknown} changeId Имя активного или архивного Change.
 * @param {string} ticket Нормализованный Jira ticket key.
 * @returns {boolean} Совпадает ли Change с ticket без учёта регистра.
 */
function matchesTicket(changeId, ticket) {
  const prefix = ticket.toLowerCase();
  const normalized = String(changeId).toLowerCase();
  return normalized === prefix || normalized.startsWith(`${prefix}-`);
}

/**
 * Находит активные и архивные Changes, уже связанные с ticket.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} ticket Нормализованный Jira ticket key.
 * @param {Array<{name: string}>} activeChanges Активные Changes из OpenSpec.
 * @returns {Promise<{active: string[], archived: string[]}>} Найденные дубли по состоянию.
 */
async function findDuplicates(projectRoot, ticket, activeChanges) {
  const active = [];
  for (const change of activeChanges) {
    if (typeof change?.name !== "string" || !change.name) {
      throw new Error("openspec list --changes вернула Change без корректного name");
    }
    if (matchesTicket(change.name, ticket)) active.push(change.name);
  }
  const archived = [];
  const archiveRoot = path.join(projectRoot, PATHS.archive);
  let entries = [];
  try {
    entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlink внутри openspec/changes/archive не поддерживается: ${entry.name}`);
    }
    if (!entry.isDirectory()) continue;
    const changeId = entry.name.match(ARCHIVE_PREFIX)?.[1] ?? entry.name;
    if (matchesTicket(changeId, ticket)) archived.push(entry.name);
  }
  return { active, archived };
}

/**
 * Проверяет результат интерактивного выбора и восстанавливает объекты репозиториев.
 *
 * @param {ResolvedRepository[]} available Все доступные Code Repositories.
 * @param {unknown} selectedIds Значение, возвращённое интерактивным selector.
 * @returns {ResolvedRepository[]} Выбранные репозитории без повторов.
 */
function validateSelection(available, selectedIds) {
  if (!Array.isArray(selectedIds)) {
    throw new Error("Интерактивный выбор репозиториев вернул некорректный результат");
  }
  const byId = new Map(available.map((repository) => [repository.id, repository]));
  const selected = [];
  const seen = new Set();
  for (const id of selectedIds) {
    if (typeof id !== "string" || !byId.has(id)) {
      throw new Error(`Выбран неизвестный Code Repository: ${String(id)}`);
    }
    if (seen.has(id)) throw new Error(`Code Repository выбран повторно: ${id}`);
    seen.add(id);
    selected.push(byId.get(id));
  }
  return selected;
}

/**
 * Проверяет Jira-style ticket key, используемый как внешний ID процесса.
 *
 * @param {unknown} ticket Проверяемое значение.
 * @returns {string} Ticket в исходном верхнем регистре.
 */
export function validateTicket(ticket) {
  if (!TICKET_PATTERN.test(ticket)) {
    throw new Error("Ticket key должен иметь формат <PROJECT>-<number>, например PAY-412");
  }
  return ticket;
}

/**
 * Нормализует обязательный текст, который попадёт в агентский вызов.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {string} label Название значения для ошибки.
 * @returns {string} Обрезанный непустой текст.
 */
function requireExploreText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Для Explore требуется ${label}`);
  }
  return value.trim();
}

/**
 * Собирает одну готовую команду `/opsx-explore` из проверенного результата CLI.
 *
 * @param {ExplorePreparation & {intent: string}} result Проверенная область и намерение запроса.
 * @returns {string} Полная slash-команда, которую пользователь копирует без редактирования.
 */
export function buildExploreInvocation(result) {
  const intent = requireExploreText(result.intent, "намерение запроса");
  const repositoryScope = result.projectSpecsOnly
    ? `Code Repositories не выбраны: исследуй только ${result.storeRepositoryId}`
    : `Code Repositories: ${result.repositories
        .map(
          ({ id, branch, revision, path: repositoryPath }) =>
            `${id}, branch=${branch}, revision=${revision}, path=${JSON.stringify(repositoryPath)}`,
        )
        .join("; ")}`;
  const allowedRoots = [
    result.projectRoot,
    ...result.repositories.map(({ path: value }) => value),
  ];
  return [
    `${EXPLORE_ACTION.invocation} ${result.ticket}.`,
    EXPLORE_ACTION.introduction,
    `Исходное намерение: ${JSON.stringify(intent)}.`,
    `Используй OpenSpec Store ${JSON.stringify(result.storeRepositoryId)}, Spec Root ${JSON.stringify(result.projectRoot)}, branch=${result.store.branch}, revision=${result.store.revision} и workspace ${JSON.stringify(result.workspace)}.`,
    `${repositoryScope}.`,
    `Разрешённые корни чтения: ${allowedRoots.map((value) => JSON.stringify(value)).join(", ")}.`,
    ...EXPLORE_ACTION.instructions,
  ].join(" ");
}

/**
 * Проверяет Store и workspace и возвращает read-only-область будущего Explore.
 *
 * @param {object} [options] Параметры подготовки.
 * @param {string} [options.start] Текущий Store, его вложенный путь или Code Repository.
 * @param {string} [options.workspace] Явный корень multi-repo workspace.
 * @param {string} options.ticket Jira ticket key.
 * @param {(repositories: ResolvedRepository[]) => Promise<string[]> | string[]} options.selectRepositories
 * Интерактивный выбор Code Repositories.
 * @param {(changes: string[]) => Promise<boolean> | boolean} [options.confirmArchivedChange]
 * Подтверждение повторного Explore для архивного ticket.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд; переопределяется в тестах.
 * @returns {Promise<ExplorePreparation>} Проверенная область без постоянного runtime manifest.
 */
export async function prepareExplore({
  start = process.cwd(),
  workspace: requestedWorkspace,
  ticket,
  selectRepositories,
  confirmArchivedChange,
  commandRunner = runCommand,
} = {}) {
  validateTicket(ticket);
  if (typeof selectRepositories !== "function") {
    throw new Error("Для sdd explore требуется интерактивный выбор репозиториев");
  }

  const startContext = await resolveStart(start, commandRunner);
  const projectRoot = startContext.projectRoot;
  const [metadataSource, configSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, PATHS.metadata), TEXT_ENCODING),
    fs.readFile(path.join(projectRoot, PATHS.sddConfig), TEXT_ENCODING),
  ]);
  const metadata = parseStoreMetadata(metadataSource);
  const config = parseSddConfig(configSource);
  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в sdd.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }

  await validateOpenSpecAction(projectRoot, config.agent);
  const activeChanges = validateOpenSpec(
    projectRoot,
    metadata.id,
    config.openSpecVersion,
    commandRunner,
  );

  if (startContext.discovery) {
    assertOpenSpecRoot(
      startContext.discovery.doctor.root,
      { path: projectRoot, storeId: metadata.id, source: "declared" },
      "openspec doctor --json",
    );
    assertOpenSpecRoot(
      startContext.discovery.context.root,
      { path: projectRoot, storeId: metadata.id, source: "declared" },
      "openspec context --json",
    );
  }

  const workspace = await resolveWorkspace(projectRoot, requestedWorkspace);
  const available = await resolveCodeRepositories(
    workspace,
    config.codeRepositories,
    commandRunner,
  );
  if (
    startContext.codeRoot &&
    !available.some(({ path: repositoryPath }) => repositoryPath === startContext.codeRoot)
  ) {
    throw new Error("Текущий Code Repository не зарегистрирован в sdd.yaml этого Store");
  }

  const store = inspectFreshCheckout(projectRoot, config.storeRepository, commandRunner);
  const duplicates = await findDuplicates(projectRoot, ticket, activeChanges);
  if (duplicates.active.length > 0) {
    throw new Error(
      `Активный Change с ticket ${ticket} уже существует: ${duplicates.active.join(", ")}`,
    );
  }
  if (duplicates.archived.length > 0) {
    if (typeof confirmArchivedChange !== "function") {
      throw new Error(`Найден архивный Change с ticket ${ticket}; требуется подтверждение`);
    }
    if (!(await confirmArchivedChange(duplicates.archived))) {
      throw new Error("Explore отменён: архивный Change не подтверждён");
    }
  }

  const selected = validateSelection(available, await selectRepositories(available));
  const repositories = [];
  for (const repository of selected) {
    const git = inspectFreshCheckout(repository.path, repository, commandRunner);
    await validatePointer(repository, metadata.id, projectRoot, commandRunner);
    repositories.push({ id: repository.id, path: repository.path, ...git });
  }

  return {
    ticket,
    projectRoot,
    storeRepositoryId: metadata.id,
    store,
    workspace,
    projectSpecsOnly: repositories.length === 0,
    repositories,
  };
}
