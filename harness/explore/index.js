import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const OPEN_SPEC_VERSION = "1.7.0";
const PROJECT_SPECS_REPOSITORY_ID = "project-specs";
const ARCHIVE_DIRECTORY_NAME = "archive";
const GITIGNORE_CHECKOUTS_RULE = ".sdd/checkouts/";

const EXECUTABLES = Object.freeze({
  git: "git",
  openSpec: "openspec",
});

const OPEN_SPEC_ARGUMENTS = Object.freeze({
  version: Object.freeze(["--version"]),
  listSpecs: Object.freeze(["list", "--specs", "--json"]),
  update: Object.freeze(["update", "--force"]),
});

const GIT_ARGUMENTS = Object.freeze({
  clone: Object.freeze(["clone", "--single-branch", "--no-tags", "--branch"]),
  revision: Object.freeze(["rev-parse", "HEAD"]),
  currentBranch: Object.freeze(["branch", "--show-current"]),
  cleanStatus: Object.freeze(["status", "--porcelain", "--untracked-files=all"]),
  workingDirectory: "-C",
  optionSeparator: "--",
});

const PATHS = Object.freeze({
  sddConfig: "sdd.yaml",
  gitIgnore: ".gitignore",
  openSpecConfig: path.join("openspec", "config.yaml"),
  openSpecChanges: path.join("openspec", "changes"),
  openSpecContextStart: path.join("openspec", "context", "00-start-here.md"),
  openSpecSystemMap: path.join("openspec", "context", "system-map.yaml"),
  openSpecExploreAction: path.join(".qwen", "commands", "opsx-explore.md"),
  exploreRoot: path.join(".sdd", "checkouts", "explore"),
});

const CHANGE_FILES = Object.freeze({
  marker: ".openspec.yaml",
  state: "state.yaml",
});

const FILE_MODES = Object.freeze({
  anyExecutable: 0o111,
  writableDirectory: 0o755,
  writableExecutable: 0o755,
  writableFile: 0o644,
  readOnlyDirectory: 0o555,
  readOnlyExecutable: 0o555,
  readOnlyFile: 0o444,
  lock: 0o600,
});

const OPEN_FLAGS = Object.freeze({
  exclusiveCreate: "wx",
});

const ERROR_CODES = Object.freeze({
  alreadyExists: "EEXIST",
  notFound: "ENOENT",
});

const TEXT_ENCODING = "utf8";
const COMMAND_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});

const SDD_CONFIG = Object.freeze({
  versionsSection: "versions",
  repositoriesSection: "repositories",
  openSpecKey: "openspec",
  defaultBranchKey: "default_branch",
});

const WORKSPACE_NAMING = Object.freeze({
  lockSuffix: ".lock",
  temporaryMarker: ".tmp-",
});

const EXPLORE_ACTION = Object.freeze({
  invocation: "/opsx-explore",
  introduction: "Это Explore шага 01 SDD.",
  instructions: Object.freeze([
    "Работай только на чтение: не создавай Change, OpenSpec-артефакты, TODO, ADR, ветку или PR и не изменяй context pack, Master Specs либо код.",
    "Не обращайся к Jira API: ticket и описание запроса получай только из этой сессии.",
    `Прочитай ${PATHS.openSpecContextStart}, назначенный им контекст и подходящие Master Specs; для каждого checkout проверь ветку, точную ревизию и чистоту до и после исследования.`,
    "Верни структурированный итог: ticket, проблема, ожидаемый результат, прочитанные источники, исследованные репозитории и ревизии, текущее поведение, область влияния, альтернативы, факты и источники, предположения, открытые вопросы с владельцами и признаком блокировки.",
    "Если нужен ещё один Code Repository, остановись и попроси повторить sdd explore с полным набором.",
  ]),
});

const TICKET_PATTERN = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const STATE_TICKET_PATTERN = /^ticket\s*:\s*(.+?)\s*$/gm;
const HTTP_PROTOCOLS = Object.freeze(["http:", "https:"]);
const REQUIRED_ROOT_PATHS = Object.freeze([
  PATHS.sddConfig,
  PATHS.openSpecConfig,
  PATHS.openSpecContextStart,
  PATHS.openSpecSystemMap,
]);

function commandError(command, result, sensitiveValues = []) {
  let details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  for (const value of sensitiveValues) {
    if (value) details = details.split(value).join("<repository-url>");
  }
  return new Error(
    `${command} завершилась с ошибкой${details ? `:\n${details}` : ""}`,
  );
}

export function runCommand(command, args, { cwd, sensitiveValues = [] } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: TEXT_ENCODING,
    env: {
      ...process.env,
      ...COMMAND_ENV,
    },
  });

  if (result.error) {
    throw new Error(`Не удалось запустить ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) throw commandError(command, result, sensitiveValues);

  return result.stdout.trim();
}

function parseScalar(value, label) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`В sdd.yaml не задано значение ${label}`);

  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "string" || !parsed) throw new Error("not a string");
      return parsed;
    } catch {
      throw new Error(`Некорректное строковое значение ${label} в sdd.yaml`);
    }
  }

  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new Error(`Некорректное строковое значение ${label} в sdd.yaml`);
    }
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

function sectionLines(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${name}:`).test(line));
  if (start === -1) throw new Error(`В sdd.yaml отсутствует секция ${name}`);

  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
    result.push(line);
  }
  return { header: lines[start], lines: result };
}

function containsEmbeddedHttpCredential(value) {
  try {
    const url = new URL(value);
    return HTTP_PROTOCOLS.includes(url.protocol) && Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

export function parseSddConfig(source) {
  const versions = sectionLines(source, SDD_CONFIG.versionsSection);
  const openSpecLinePattern = new RegExp(`^\\s+${SDD_CONFIG.openSpecKey}\\s*:`);
  const openSpecLine = versions.lines.find((line) => openSpecLinePattern.test(line));
  if (!openSpecLine) throw new Error("В sdd.yaml отсутствует versions.openspec");
  const openSpecVersion = parseScalar(
    openSpecLine.replace(openSpecLinePattern, ""),
    "versions.openspec",
  );

  const repositorySection = sectionLines(source, SDD_CONFIG.repositoriesSection);
  const repositories = [];
  let current = null;

  if (!/^repositories:\s*\[\s*\]\s*(?:#.*)?$/.test(repositorySection.header)) {
    for (const line of repositorySection.lines) {
      if (!line.trim() || /^\s*#/.test(line)) continue;

      const idMatch = line.match(/^\s*-\s+id\s*:\s*(.+)$/);
      if (idMatch) {
        if (current) repositories.push(current);
        current = { id: parseScalar(idMatch[1], "repositories[].id") };
        continue;
      }

      const fieldMatch = line.match(/^\s+(url|default_branch)\s*:\s*(.+)$/);
      if (fieldMatch && current) {
        const field = fieldMatch[1] === SDD_CONFIG.defaultBranchKey ? "defaultBranch" : "url";
        if (current[field] !== undefined) {
          throw new Error(`Повторяющееся поле repositories[].${fieldMatch[1]} в sdd.yaml`);
        }
        current[field] = parseScalar(fieldMatch[2], `repositories[].${fieldMatch[1]}`);
        continue;
      }

      throw new Error(`Неподдерживаемая строка в секции repositories sdd.yaml: ${line.trim()}`);
    }
    if (current) repositories.push(current);
  }

  const ids = new Set();
  for (const repository of repositories) {
    if (!REPOSITORY_ID_PATTERN.test(repository.id)) {
      throw new Error(`Некорректный repository-id в sdd.yaml: ${repository.id}`);
    }
    if (!repository.url || !repository.defaultBranch) {
      throw new Error(`Для repository-id ${repository.id} требуются url и default_branch`);
    }
    if (repository.url.startsWith("-") || repository.defaultBranch.startsWith("-")) {
      throw new Error(`Некорректные Git-параметры для repository-id ${repository.id}`);
    }
    if (containsEmbeddedHttpCredential(repository.url)) {
      throw new Error(
        `URL repository-id ${repository.id} содержит credential; используйте внешний Git credential helper`,
      );
    }
    if (ids.has(repository.id)) {
      throw new Error(`Повторяющийся repository-id в sdd.yaml: ${repository.id}`);
    }
    ids.add(repository.id);
  }

  return { openSpecVersion, repositories };
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error.code === ERROR_CODES.notFound) return false;
    throw error;
  }
}

export async function findSpecRoot(start = process.cwd()) {
  let candidate = path.resolve(start);
  try {
    if (!(await fs.stat(candidate)).isDirectory()) candidate = path.dirname(candidate);
  } catch (error) {
    if (error.code === ERROR_CODES.notFound) {
      throw new Error(`Начальный путь не существует: ${candidate}`);
    }
    throw error;
  }

  while (true) {
    const matches = await Promise.all(
      REQUIRED_ROOT_PATHS.map((relativePath) => isFile(path.join(candidate, relativePath))),
    );
    if (matches.every(Boolean)) return candidate;

    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }

  throw new Error(
    "Не удалось найти Spec Root с sdd.yaml, openspec/config.yaml и обязательным context pack",
  );
}

async function assertNoSymlinkComponents(root, relativePath) {
  let current = root;
  for (const component of relativePath.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Временный путь не должен быть symlink: ${current}`);
      }
      if (!stat.isDirectory()) throw new Error(`Ожидался каталог: ${current}`);
    } catch (error) {
      if (error.code === ERROR_CODES.notFound) return;
      throw error;
    }
  }
}

async function validateOpenSpecAction(projectRoot) {
  // OpenSpec owns this generated file. A content fingerprint would couple SDD to one OpenSpec release.
  const actionPath = path.join(projectRoot, PATHS.openSpecExploreAction);
  let stat;
  try {
    stat = await fs.lstat(actionPath);
  } catch (error) {
    if (error.code === ERROR_CODES.notFound) {
      throw new Error(
        `Не установлено оригинальное действие OpenSpec ${PATHS.openSpecExploreAction}; восстановите его штатным ${EXECUTABLES.openSpec} ${OPEN_SPEC_ARGUMENTS.update.join(" ")}`,
      );
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Действие OpenSpec opsx-explore.md должно быть обычным файлом");
  }
}

async function validateGitIgnore(projectRoot) {
  const gitIgnorePath = path.join(projectRoot, PATHS.gitIgnore);
  if (!(await isFile(gitIgnorePath))) {
    throw new Error(
      `В Spec Root отсутствует ${PATHS.gitIgnore} с правилом ${GITIGNORE_CHECKOUTS_RULE}`,
    );
  }
  const rules = (await fs.readFile(gitIgnorePath, TEXT_ENCODING))
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!rules.includes(GITIGNORE_CHECKOUTS_RULE)) {
    throw new Error(
      `В ${PATHS.gitIgnore} отсутствует обязательное точное правило ${GITIGNORE_CHECKOUTS_RULE}`,
    );
  }
}

async function validateOpenSpec(projectRoot, configuredVersion, commandRunner) {
  if (configuredVersion !== OPEN_SPEC_VERSION) {
    throw new Error(
      `${PATHS.sddConfig} требует OpenSpec ${configuredVersion}, поддерживается ${OPEN_SPEC_VERSION}`,
    );
  }

  const installedVersion = commandRunner(EXECUTABLES.openSpec, OPEN_SPEC_ARGUMENTS.version, {
    cwd: projectRoot,
  });
  if (installedVersion !== configuredVersion) {
    throw new Error(
      `Установлен OpenSpec ${installedVersion || "неизвестной версии"}, ожидается ${configuredVersion}`,
    );
  }

  const output = commandRunner(EXECUTABLES.openSpec, OPEN_SPEC_ARGUMENTS.listSpecs, {
    cwd: projectRoot,
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("openspec list --specs --json вернул невалидный JSON");
  }
  if (!Array.isArray(parsed.specs)) {
    throw new Error("openspec list --specs --json не вернул список specs");
  }
  if (parsed.root?.path && path.resolve(parsed.root.path) !== projectRoot) {
    throw new Error(`OpenSpec разрешил другой root: ${parsed.root.path}`);
  }
}

async function collectChangeDirectories(changesRoot) {
  if (!(await isFile(path.join(path.dirname(changesRoot), path.basename(PATHS.openSpecConfig))))) {
    return [];
  }

  const found = new Set();
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === ERROR_CODES.notFound) return;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink внутри openspec/changes не поддерживается: ${entryPath}`);
      }
      if (entry.isDirectory()) await visit(entryPath);
      if (
        entry.isFile() &&
        (entry.name === CHANGE_FILES.marker || entry.name === CHANGE_FILES.state)
      ) {
        found.add(directory);
      }
    }
  }

  await visit(changesRoot);
  return [...found].sort();
}

function parseStateTicket(source, statePath) {
  const matches = [...source.matchAll(STATE_TICKET_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`Невозможно определить ticket в ${statePath}`);
  }
  const ticket = parseScalar(matches[0][1], `ticket в ${statePath}`);
  if (!TICKET_PATTERN.test(ticket)) {
    throw new Error(`Некорректный ticket в ${statePath}: ${ticket}`);
  }
  return ticket;
}

async function inspectExistingChanges(projectRoot, ticket) {
  const changesRoot = path.join(projectRoot, PATHS.openSpecChanges);
  const directories = await collectChangeDirectories(changesRoot);
  const active = [];
  const archived = [];

  for (const directory of directories) {
    const relative = path.relative(changesRoot, directory);
    const statePath = path.join(directory, CHANGE_FILES.state);
    let stat;
    try {
      stat = await fs.lstat(statePath);
    } catch (error) {
      if (error.code === ERROR_CODES.notFound) {
        throw new Error(`У Change ${relative} отсутствует ${CHANGE_FILES.state}`);
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Некорректный state.yaml у Change ${relative}`);
    }

    let changeTicket;
    try {
      changeTicket = parseStateTicket(await fs.readFile(statePath, TEXT_ENCODING), statePath);
    } catch (error) {
      throw new Error(`Невозможно проверить дубликаты: ${error.message}`);
    }
    if (changeTicket !== ticket) continue;

    if (relative.split(path.sep)[0] === ARCHIVE_DIRECTORY_NAME) archived.push(relative);
    else active.push(relative);
  }

  return { active, archived };
}

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

async function makeWritable(target) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error.code === ERROR_CODES.notFound) return;
    throw error;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.chmod(target, FILE_MODES.writableDirectory);
    const entries = await fs.readdir(target);
    for (const entry of entries) await makeWritable(path.join(target, entry));
    return;
  }
  await fs.chmod(
    target,
    stat.mode & FILE_MODES.anyExecutable
      ? FILE_MODES.writableExecutable
      : FILE_MODES.writableFile,
  );
}

async function removeTree(target) {
  if (!target) return;
  await makeWritable(target);
  await fs.rm(target, { recursive: true, force: true });
}

async function makeReadOnly(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    const entries = await fs.readdir(target);
    for (const entry of entries) await makeReadOnly(path.join(target, entry));
    await fs.chmod(target, FILE_MODES.readOnlyDirectory);
    return;
  }
  await fs.chmod(
    target,
    stat.mode & FILE_MODES.anyExecutable
      ? FILE_MODES.readOnlyExecutable
      : FILE_MODES.readOnlyFile,
  );
}

async function acquireLock(lockPath) {
  try {
    const handle = await fs.open(lockPath, OPEN_FLAGS.exclusiveCreate, FILE_MODES.lock);
    await handle.writeFile(`${process.pid}\n`, TEXT_ENCODING);
    return handle;
  } catch (error) {
    if (error.code === ERROR_CODES.alreadyExists) {
      throw new Error(`Explore для этого ticket уже подготавливается: ${lockPath}`);
    }
    throw error;
  }
}

async function cloneRepository(repository, destination, commandRunner) {
  commandRunner(
    EXECUTABLES.git,
    [
      ...GIT_ARGUMENTS.clone,
      repository.defaultBranch,
      GIT_ARGUMENTS.optionSeparator,
      repository.url,
      destination,
    ],
    { sensitiveValues: [repository.url] },
  );

  const revision = commandRunner(EXECUTABLES.git, [
    GIT_ARGUMENTS.workingDirectory,
    destination,
    ...GIT_ARGUMENTS.revision,
  ]);
  if (!GIT_REVISION_PATTERN.test(revision)) {
    throw new Error(`Git вернул некорректную ревизию для ${repository.id}`);
  }

  const branch = commandRunner(EXECUTABLES.git, [
    GIT_ARGUMENTS.workingDirectory,
    destination,
    ...GIT_ARGUMENTS.currentBranch,
  ]);
  if (branch !== repository.defaultBranch) {
    throw new Error(
      `Репозиторий ${repository.id} открыт на ветке ${branch}, ожидалась ${repository.defaultBranch}`,
    );
  }

  const changes = commandRunner(
    EXECUTABLES.git,
    [GIT_ARGUMENTS.workingDirectory, destination, ...GIT_ARGUMENTS.cleanStatus],
  );
  if (changes) throw new Error(`Checkout ${repository.id} содержит локальные изменения`);

  return revision;
}

export function validateTicket(ticket) {
  if (!TICKET_PATTERN.test(ticket)) {
    throw new Error("Ticket key должен иметь формат <PROJECT>-<number>, например PAY-412");
  }
  return ticket;
}

export function buildExploreInvocation(result) {
  const repositoryScope = result.projectSpecsOnly
    ? `Code Repositories не выбраны: исследуй только ${PROJECT_SPECS_REPOSITORY_ID}`
    : `Code Repositories: ${result.repositories
        .map(
          (repository) =>
            `${repository.id}, branch=${repository.branch}, revision=${repository.revision}, path=${JSON.stringify(repository.path)}`,
        )
        .join("; ")}`;

  return [
    `${EXPLORE_ACTION.invocation} ${result.ticket}.`,
    EXPLORE_ACTION.introduction,
    `Используй Spec Root ${JSON.stringify(result.projectRoot)} и подготовленный read-only workspace ${JSON.stringify(result.workspace)}.`,
    `${repositoryScope}.`,
    ...EXPLORE_ACTION.instructions,
  ].join(" ");
}

export async function prepareExplore({
  start = process.cwd(),
  ticket,
  selectRepositories,
  confirmArchivedChange,
  commandRunner = runCommand,
} = {}) {
  validateTicket(ticket);
  if (typeof selectRepositories !== "function") {
    throw new Error("Для sdd explore требуется интерактивный выбор репозиториев");
  }

  const projectRoot = await findSpecRoot(start);
  const config = parseSddConfig(
    await fs.readFile(path.join(projectRoot, PATHS.sddConfig), TEXT_ENCODING),
  );
  const projectRepositories = config.repositories.filter(
    (repository) => repository.id === PROJECT_SPECS_REPOSITORY_ID,
  );
  if (projectRepositories.length !== 1) {
    throw new Error(
      `${PATHS.sddConfig} должен содержать ровно один repository-id ${PROJECT_SPECS_REPOSITORY_ID}`,
    );
  }

  await validateOpenSpecAction(projectRoot);
  await validateGitIgnore(projectRoot);
  await assertNoSymlinkComponents(projectRoot, PATHS.exploreRoot);
  await validateOpenSpec(projectRoot, config.openSpecVersion, commandRunner);

  const duplicates = await inspectExistingChanges(projectRoot, ticket);
  if (duplicates.active.length > 0) {
    throw new Error(
      `Активный Change с ticket ${ticket} уже существует: ${duplicates.active.join(", ")}`,
    );
  }
  if (duplicates.archived.length > 0) {
    if (typeof confirmArchivedChange !== "function") {
      throw new Error(`Найден архивный Change с ticket ${ticket}; требуется подтверждение`);
    }
    const confirmed = await confirmArchivedChange(duplicates.archived);
    if (!confirmed) throw new Error("Explore отменён: архивный Change не подтверждён");
  }

  const available = config.repositories.filter(
    (repository) => repository.id !== PROJECT_SPECS_REPOSITORY_ID,
  );
  const selected = validateSelection(available, await selectRepositories(available));

  const exploreRoot = path.join(projectRoot, PATHS.exploreRoot);
  await fs.mkdir(exploreRoot, { recursive: true });
  await assertNoSymlinkComponents(projectRoot, PATHS.exploreRoot);

  const ticketName = ticket.toLowerCase();
  const workspace = path.join(exploreRoot, ticketName);
  const lockPath = path.join(exploreRoot, `.${ticketName}${WORKSPACE_NAMING.lockSuffix}`);
  const lock = await acquireLock(lockPath);
  let temporaryWorkspace;

  try {
    await removeTree(workspace);
    temporaryWorkspace = await fs.mkdtemp(
      path.join(exploreRoot, `.${ticketName}${WORKSPACE_NAMING.temporaryMarker}`),
    );
    const prepared = [];

    for (const repository of selected) {
      const temporaryCheckout = path.join(temporaryWorkspace, repository.id);
      const revision = await cloneRepository(repository, temporaryCheckout, commandRunner);
      prepared.push({
        id: repository.id,
        branch: repository.defaultBranch,
        revision,
      });
    }

    await makeReadOnly(temporaryWorkspace);
    await fs.rename(temporaryWorkspace, workspace);
    temporaryWorkspace = undefined;

    return {
      ticket,
      projectRoot,
      workspace,
      projectSpecsOnly: prepared.length === 0,
      repositories: prepared.map((repository) => ({
        ...repository,
        path: path.join(workspace, repository.id),
      })),
    };
  } catch (error) {
    await removeTree(temporaryWorkspace);
    await removeTree(workspace);
    throw error;
  } finally {
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}
