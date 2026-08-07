/** @fileoverview Однократная инициализация центрального OpenSpec Store и SDD skeleton. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  assertRepositoryId,
  assertSupportedOpenSpecVersion,
  parseSddConfig,
  parseStoreMetadata,
  serializeSddConfig,
} from "../config/index.js";
import { resolveAgentAdapter } from "../config/agents.js";
import { runCommand } from "../shared/command.js";
import { parseOpenSpecJson } from "../shared/openspec.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SUFFIX = ".template";
const REPOSITORY_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/;

const PATHS = Object.freeze({
  skeleton: path.join(MODULE_ROOT, "skeleton"),
  commandTemplates: path.join(MODULE_ROOT, "commands"),
  agentTemplates: path.join(MODULE_ROOT, "agents"),
  metadata: path.join(".openspec-store", "store.yaml"),
  openSpecConfig: path.join("openspec", "config.yaml"),
  alternateOpenSpecConfig: path.join("openspec", "config.yml"),
  sddConfig: "sdd.yaml",
  gitIgnore: ".gitignore",
  codeOwners: "CODEOWNERS",
});

const SHARED_PROJECT_FILES = new Set([PATHS.gitIgnore, PATHS.codeOwners]);

/**
 * Файл встроенного bundle и его итоговый путь в проекте.
 *
 * @typedef {object} BundleFile
 * @property {string} source Абсолютный путь файла шаблона.
 * @property {string} target Относительный путь назначения.
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
 * Рекурсивно перечисляет обычные файлы bundle в стабильном порядке.
 *
 * @param {string} root Абсолютный корень bundle.
 * @param {string} [relativeDirectory] Текущий относительный подкаталог рекурсии.
 * @returns {Promise<string[]>} Отсортированные относительные пути файлов.
 */
async function listFiles(root, relativeDirectory = "") {
  const entries = await fs.readdir(path.join(root, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

/**
 * Преобразует имя шаблона в итоговый путь проекта.
 *
 * @param {string} relativePath Относительный путь внутри bundle.
 * @returns {string} Путь назначения без служебного суффикса `.template`.
 */
function bundleTarget(relativePath) {
  return relativePath.endsWith(TEMPLATE_SUFFIX)
    ? relativePath.slice(0, -TEMPLATE_SUFFIX.length)
    : relativePath;
}

/**
 * Устанавливает официальный OpenSpec pack профиля core в центральный проект.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {string} agentAdapter ID официального OpenSpec adapter.
 * @param {typeof runCommand} commandRunner Исполнитель внешних команд.
 * @returns {void}
 */
function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  commandRunner(
    "openspec",
    ["init", projectRoot, "--tools", agentAdapter, "--profile", "core", "--no-animation"],
    { cwd: projectRoot },
  );
}

/**
 * Создаёт Store официальной командой OpenSpec и проверяет её identity.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {string} storeId Общий Store ID и repository-id.
 * @param {string} remote Канонический Git URL центрального репозитория.
 * @param {typeof runCommand} commandRunner Исполнитель внешних команд.
 * @returns {void}
 */
function setupStore(projectRoot, storeId, remote, commandRunner) {
  const output = commandRunner(
    "openspec",
    [
      "store",
      "setup",
      storeId,
      "--path",
      projectRoot,
      "--no-init-git",
      "--remote",
      remote,
      "--json",
    ],
    { cwd: projectRoot, sensitiveValues: [remote] },
  );
  const result = parseOpenSpecJson(output, `openspec store setup ${storeId}`);
  if (result.store?.id !== storeId || path.resolve(result.store?.root ?? "") !== projectRoot) {
    throw new Error("openspec store setup вернула другой Store");
  }
}

/**
 * Проверяет Git-предусловия `sdd init` и читает identity центрального репозитория.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {typeof runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<{remote: string, defaultBranch: string}>} Origin и текущая основная ветка.
 */
async function inspectGit(projectRoot, commandRunner) {
  const gitRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot }),
  );
  if (gitRoot !== projectRoot) {
    throw new Error("sdd init нужно запускать из корня центрального Git-репозитория");
  }
  if (commandRunner("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: projectRoot,
  })) {
    throw new Error("sdd init требует чистое рабочее дерево Git");
  }

  const remote = commandRunner("git", ["remote", "get-url", "origin"], {
    cwd: projectRoot,
  });
  const defaultBranch = commandRunner("git", ["branch", "--show-current"], {
    cwd: projectRoot,
  });
  if (!defaultBranch) throw new Error("sdd init нельзя запускать в detached HEAD");
  return { remote, defaultBranch };
}

/**
 * Блокирует конфликтующие управляемые пути до первого изменения проекта.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {BundleFile[]} bundleFiles Файлы, которые установит SDD.
 * @param {{id: string, commandsDirectory: string, generatedDirectory: string | null}} agent
 * Выбранный agent adapter.
 * @returns {Promise<void>}
 */
async function assertSkeletonDoesNotExist(projectRoot, bundleFiles, agent) {
  const conflicts = [];
  for (const relativePath of bundleFiles.map(({ target }) => target)) {
    const stat = await pathState(path.join(projectRoot, relativePath));
    if (!stat) continue;
    if (SHARED_PROJECT_FILES.has(relativePath) || relativePath === PATHS.openSpecConfig) {
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`${relativePath} должен быть обычным файлом`);
      }
      continue;
    }
    conflicts.push(relativePath);
  }
  if (conflicts.length > 0) {
    throw new Error(`Инициализации мешают существующие SDD/OpenSpec-пути: ${conflicts.join(", ")}`);
  }

  const agentRoot = agent.commandsDirectory.split("/")[0];
  const agentDirectory = await pathState(path.join(projectRoot, agentRoot));
  if (agentDirectory && agent.generatedDirectory) {
    throw new Error(`${agentRoot}/ должен отсутствовать до первичной настройки ${agent.id}`);
  }
  if (agentDirectory && (!agentDirectory.isDirectory() || agentDirectory.isSymbolicLink())) {
    throw new Error(`${agentRoot}/ должна быть обычным каталогом`);
  }
  if (agent.generatedDirectory) {
    const generatedDirectory = await pathState(
      path.join(projectRoot, agent.generatedDirectory),
    );
    if (
      generatedDirectory &&
      (!generatedDirectory.isDirectory() || generatedDirectory.isSymbolicLink())
    ) {
      throw new Error(`${agent.generatedDirectory}/ должна быть обычным каталогом`);
    }
  }
}

/**
 * Переносит совместимый Qwen pack в provider-specific каталог GigaCode.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {{id: string, commandsDirectory: string, generatedDirectory: string | null}} agent
 * Выбранный agent adapter.
 * @returns {Promise<void>}
 */
async function adaptGeneratedAgentPack(projectRoot, agent) {
  if (!agent.generatedDirectory) return;
  const source = path.join(projectRoot, agent.generatedDirectory);
  const destination = path.join(projectRoot, agent.commandsDirectory.split("/")[0]);
  const sourceStat = await pathState(source);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`OpenSpec не создал ожидаемый совместимый pack ${agent.generatedDirectory}/`);
  }
  const destinationStat = await pathState(destination);
  if (destinationStat) {
    throw new Error(`Нельзя перенести agent pack: уже существует ${destination}`);
  }
  await fs.rename(source, destination);
}

/**
 * Добавляет текстовый блок после существующего содержимого с одной пустой строкой.
 *
 * @param {string} current Текущее содержимое файла.
 * @param {string} block Добавляемый блок.
 * @returns {string} Нормализованное объединённое содержимое с финальным переводом строки.
 */
function appendBlock(current, block) {
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block.trim()}\n`;
}

/**
 * Дополняет существующие `.gitignore` или `CODEOWNERS`, не затирая проектные правила.
 *
 * @param {string} source Путь встроенного шаблона.
 * @param {string} destination Путь существующего проектного файла.
 * @param {string} relativePath Относительный путь, определяющий стратегию слияния.
 * @returns {Promise<boolean>} Было ли содержимое файла изменено.
 */
async function mergeSharedProjectFile(source, destination, relativePath) {
  const [current, template] = await Promise.all([
    fs.readFile(destination, "utf8"),
    fs.readFile(source, "utf8"),
  ]);

  if (relativePath === PATHS.gitIgnore) {
    const existingRules = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missingRules = template
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !existingRules.has(line));
    if (missingRules.length === 0) return false;
    await fs.writeFile(
      destination,
      appendBlock(current, `# SDD local data\n${missingRules.join("\n")}`),
      "utf8",
    );
    return true;
  }

  // В шаблоне только комментарии: его добавление не меняет действующих owners.
  if (current.includes(template.trim())) return false;
  await fs.writeFile(destination, appendBlock(current, template), "utf8");
  return true;
}

/**
 * Добавляет обязательный SDD-контекст и правила, сохраняя настройки существующего OpenSpec.
 *
 * @param {string} source Путь встроенного openspec/config.yaml.
 * @param {string} destination Путь проектного openspec/config.yaml.
 * @returns {Promise<boolean>} Был ли project config изменён.
 */
async function mergeOpenSpecConfig(source, destination) {
  const [currentSource, templateSource] = await Promise.all([
    fs.readFile(destination, "utf8"),
    fs.readFile(source, "utf8"),
  ]);
  const current = parseYaml(currentSource) ?? {};
  const template = parseYaml(templateSource);
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`${PATHS.openSpecConfig} должен содержать YAML-объект`);
  }
  if (current.store !== undefined) {
    throw new Error(`Центральный Store не может содержать pointer store: в ${PATHS.openSpecConfig}`);
  }
  if (current.schema !== undefined && current.schema !== "spec-driven") {
    throw new Error(`Для принятия проекта требуется schema: spec-driven в ${PATHS.openSpecConfig}`);
  }
  if (
    current.rules !== undefined &&
    (!current.rules || typeof current.rules !== "object" || Array.isArray(current.rules))
  ) {
    throw new Error(`${PATHS.openSpecConfig}: rules должен быть YAML-объектом`);
  }

  current.schema = "spec-driven";
  const requiredContext = template.context.trim();
  const existingContext = typeof current.context === "string" ? current.context.trim() : "";
  if (!existingContext.includes(requiredContext)) {
    current.context = existingContext
      ? `${existingContext}\n\n${requiredContext}`
      : requiredContext;
  }
  current.rules ??= {};
  for (const [artifact, rules] of Object.entries(template.rules)) {
    const existingRules = Array.isArray(current.rules[artifact]) ? current.rules[artifact] : [];
    current.rules[artifact] = [...existingRules, ...rules.filter((rule) => !existingRules.includes(rule))];
  }

  const merged = stringifyYaml(current, { lineWidth: 0 });
  if (merged === currentSource) return false;
  await fs.writeFile(destination, merged, "utf8");
  return true;
}

/**
 * Устанавливает подготовленный skeleton и безопасно объединяет общие проектные файлы.
 *
 * @param {object} options Параметры установки.
 * @param {string} options.projectRoot Абсолютный путь центрального репозитория.
 * @param {BundleFile[]} options.bundleFiles Подготовленные файлы bundle.
 * @param {string} options.sddContents Готовое содержимое sdd.yaml.
 * @returns {Promise<{created: string[], updated: string[]}>} Созданные и дополненные пути.
 */
async function installSkeleton({ projectRoot, bundleFiles, sddContents }) {
  const created = [];
  const updated = [];
  for (const file of bundleFiles) {
    const destination = path.join(projectRoot, file.target);
    const source = file.source;
    await fs.mkdir(path.dirname(destination), { recursive: true });

    if (file.target === PATHS.sddConfig) {
      const destinationStat = await pathState(destination);
      if (destinationStat) {
        throw new Error(`${PATHS.sddConfig} уже существует`);
      }
      await fs.writeFile(destination, sddContents, "utf8");
    } else if (file.target === PATHS.openSpecConfig) {
      const destinationStat = await pathState(destination);
      if (destinationStat) {
        if (await mergeOpenSpecConfig(source, destination)) updated.push(file.target);
        continue;
      }
      await fs.copyFile(source, destination);
    } else {
      const destinationStat = await pathState(destination);
      if (destinationStat && SHARED_PROJECT_FILES.has(file.target)) {
        if (await mergeSharedProjectFile(source, destination, file.target)) {
          updated.push(file.target);
        }
        continue;
      }
      if (destinationStat) {
        throw new Error(`OpenSpec создал конфликтующий файл skeleton: ${file.target}`);
      }
      await fs.copyFile(source, destination);
    }
    created.push(file.target);
  }
  return { created, updated };
}

/**
 * Разбирает значение CLI-флага `--repo <id=url#branch>`.
 *
 * @param {string} value
 * @returns {{id: string, role: "code", url: string, defaultBranch: string}}
 */
export function parseRepository(value) {
  const match = value.match(REPOSITORY_PATTERN);
  if (!match) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }
  const [, id, url, defaultBranch] = match;
  if (url.startsWith("-") || defaultBranch.startsWith("-")) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }
  return { id, role: "code", url, defaultBranch };
}

/**
 * Один раз подготавливает центральный репозиторий как OpenSpec Store.
 * Команда повторно безопасна только для Store с тем же ID; подключение новых
 * рабочих машин и code-репозиториев выполняет `sdd connect`.
 *
 * @param {object} [options]
 * @param {string} [options.target] Корень центрального Git-репозитория.
 * @param {string} options.storeId Общий ID Store и центрального репозитория.
 * @param {string} options.agentId Поддерживаемый OpenSpec agent ID.
 * @param {Array<{id: string, role: "code", url: string, defaultBranch: string}>} [options.repositories]
 * @param {string} [options.skeletonRoot] Переопределяется только в тестах.
 * @param {typeof runCommand} [options.commandRunner] Переопределяется только в тестах.
 * @returns {Promise<{
 *   target: string,
 *   storeId: string,
 *   alreadyInitialized: boolean,
 *   created: string[],
 *   updated: string[]
 * }>}
 */
export async function initProject({
  target = ".",
  storeId,
  agentId,
  repositories = [],
  skeletonRoot = PATHS.skeleton,
  commandRunner = runCommand,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  const agent = resolveAgentAdapter(agentId);
  const requestedRoot = path.resolve(target);
  const rootStat = await pathState(requestedRoot);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`sdd init требует существующий обычный каталог: ${requestedRoot}`);
  }
  const projectRoot = await fs.realpath(requestedRoot);
  if (await pathState(path.join(projectRoot, PATHS.alternateOpenSpecConfig))) {
    throw new Error(
      `${PATHS.alternateOpenSpecConfig} нужно перенести в ${PATHS.openSpecConfig} до sdd init`,
    );
  }

  const bundleFiles = (await listFiles(skeletonRoot)).map((source) => ({
    source: path.join(skeletonRoot, source),
    target: bundleTarget(source),
  }));
  for (const source of await listFiles(PATHS.commandTemplates)) {
    bundleFiles.push({
      source: path.join(PATHS.commandTemplates, source),
      target: path.join(agent.commandsDirectory, source),
    });
  }
  if (agent.instructionsFile) {
    bundleFiles.push({
      source: path.join(PATHS.agentTemplates, agent.templateDirectory, agent.instructionsFile),
      target: agent.instructionsFile,
    });
  }
  const ids = new Set([storeId]);
  for (const repository of repositories) {
    assertRepositoryId(repository.id);
    if (ids.has(repository.id)) throw new Error(`Повторяющийся repository-id: ${repository.id}`);
    ids.add(repository.id);
  }

  const metadataStat = await pathState(path.join(projectRoot, PATHS.metadata));
  if (metadataStat && (!metadataStat.isFile() || metadataStat.isSymbolicLink())) {
    throw new Error(`${PATHS.metadata} должна быть обычным файлом`);
  }
  if (metadataStat) {
    const metadata = parseStoreMetadata(
      await fs.readFile(path.join(projectRoot, PATHS.metadata), "utf8"),
    );
    if (metadata.id !== storeId) {
      throw new Error(`Store уже инициализирован с ID ${metadata.id}, а не ${storeId}`);
    }
    return {
      target: projectRoot,
      storeId,
      alreadyInitialized: true,
      created: [],
      updated: [],
    };
  }

  const git = await inspectGit(projectRoot, commandRunner);
  const configuredRepositories = [
    {
      id: storeId,
      role: "store",
      url: git.remote,
      defaultBranch: git.defaultBranch,
    },
    ...repositories,
  ];
  await assertSkeletonDoesNotExist(projectRoot, bundleFiles, agent);
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: projectRoot });
  assertSupportedOpenSpecVersion(installedVersion);
  const sddTemplate = await fs.readFile(path.join(skeletonRoot, PATHS.sddConfig), "utf8");
  const sddContents = serializeSddConfig(
    sddTemplate,
    configuredRepositories,
    agent,
    installedVersion,
  );
  parseSddConfig(sddContents);
  const hasProjectFiles = (await fs.readdir(projectRoot)).some((entry) => entry !== ".git");
  // Для существующего проекта OpenSpec root нужен до Store setup; для пустого
  // репозитория Store setup сначала создаёт root, который затем принимает init.
  if (hasProjectFiles) installOpenSpec(projectRoot, agent.openSpecId, commandRunner);
  setupStore(projectRoot, storeId, git.remote, commandRunner);
  if (!hasProjectFiles) installOpenSpec(projectRoot, agent.openSpecId, commandRunner);
  await adaptGeneratedAgentPack(projectRoot, agent);

  const installed = await installSkeleton({
    projectRoot,
    bundleFiles,
    sddContents,
  });
  return {
    target: projectRoot,
    storeId,
    alreadyInitialized: false,
    created: [PATHS.metadata, ...installed.created],
    updated: installed.updated,
  };
}
