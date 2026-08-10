/** @fileoverview Сборка и установка центрального SDD/OpenSpec skeleton. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRepositoryId,
  assertSupportedOpenSpecVersion,
  parseSddConfig,
  parseStoreMetadata,
  sameGitRemote,
  serializeSddConfig,
} from "../config/index.js";
import { resolveAgentAdapter } from "../config/agents.js";
import { runCommand } from "../shared/command.js";
import { parseOpenSpecJson } from "../shared/openspec.js";
import { mergeOpenSpecConfig, mergeSharedProjectFile } from "./merge.js";
import { inspectGit } from "./validation.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SUFFIX = ".template";
const EXPANDED_WORKFLOWS = Object.freeze([
  "propose",
  "explore",
  "new",
  "continue",
  "apply",
  "update",
  "ff",
  "sync",
  "archive",
  "bulk-archive",
  "verify",
  "onboard",
]);

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
const REQUIRED_AGENT_COMMANDS = Object.freeze([
  "opsx-explore.md",
  "opsx-continue.md",
  "opsx-update.md",
  "sdd-context.md",
  "sdd-change.md",
  "sdd-apply.md",
]);
const REQUIRED_OPEN_SPEC_DIRECTORIES = Object.freeze([
  path.join("openspec", "specs"),
  path.join("openspec", "changes", "archive"),
]);

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
 * Устанавливает официальный expanded agent pack без изменения глобального профиля пользователя.
 *
 * @param {string} projectRoot Абсолютный путь центрального репозитория.
 * @param {string} agentAdapter ID официального OpenSpec adapter.
 * @param {typeof runCommand} commandRunner Исполнитель внешних команд.
 * @returns {Promise<void>}
 */
async function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-openspec-profile-"));
  const openSpecConfigRoot = path.join(configRoot, "openspec");
  try {
    await fs.mkdir(openSpecConfigRoot, { recursive: true });
    await fs.writeFile(
      path.join(openSpecConfigRoot, "config.json"),
      `${JSON.stringify({
        profile: "custom",
        delivery: "both",
        workflows: EXPANDED_WORKFLOWS,
      }, null, 2)}\n`,
      "utf8",
    );
    commandRunner(
      "openspec",
      ["init", projectRoot, "--tools", agentAdapter, "--profile", "custom", "--no-animation"],
      { cwd: projectRoot, environment: { XDG_CONFIG_HOME: configRoot } },
    );
  } finally {
    await fs.rm(configRoot, { recursive: true, force: true });
  }
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
 * Проверяет, что Store metadata относится к полностью завершённому `sdd init`.
 * Проверка только читает проект и не пытается продолжить или откатить частичный запуск.
 *
 * @param {object} options Параметры проверки.
 * @param {string} options.projectRoot Абсолютный путь центрального репозитория.
 * @param {string} options.storeId Ожидаемый Store ID.
 * @param {{remote: string | undefined}} options.metadata Прочитанная Store metadata.
 * @param {BundleFile[]} options.bundleFiles Полный проектный bundle.
 * @param {ReturnType<typeof resolveAgentAdapter>} options.agent Выбранный agent adapter.
 * @returns {Promise<void>}
 */
async function assertInitializationComplete({
  projectRoot,
  storeId,
  metadata,
  bundleFiles,
  agent,
}) {
  const issues = [];
  const requiredFiles = new Set(bundleFiles.map(({ target }) => target));
  for (const command of REQUIRED_AGENT_COMMANDS) {
    requiredFiles.add(path.join(agent.commandsDirectory, command));
  }

  for (const relativePath of [...requiredFiles].sort()) {
    const stat = await pathState(path.join(projectRoot, relativePath));
    if (!stat) issues.push(`отсутствует ${relativePath}`);
    else if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`${relativePath} не является обычным файлом`);
    }
  }
  for (const relativePath of REQUIRED_OPEN_SPEC_DIRECTORIES) {
    const stat = await pathState(path.join(projectRoot, relativePath));
    if (!stat) issues.push(`отсутствует ${relativePath}/`);
    else if (!stat.isDirectory() || stat.isSymbolicLink()) {
      issues.push(`${relativePath}/ не является обычным каталогом`);
    }
  }

  const configStat = await pathState(path.join(projectRoot, PATHS.sddConfig));
  if (configStat?.isFile() && !configStat.isSymbolicLink()) {
    try {
      const config = parseSddConfig(
        await fs.readFile(path.join(projectRoot, PATHS.sddConfig), "utf8"),
      );
      assertSupportedOpenSpecVersion(config.openSpecVersion);
      if (config.storeRepository.id !== storeId) {
        issues.push(`Store ID в ${PATHS.sddConfig} не совпадает с Store metadata`);
      }
      if (config.agent.id !== agent.id) {
        issues.push(`agent в ${PATHS.sddConfig} не совпадает с аргументом sdd init`);
      }
      if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
        issues.push(`URL role: store в ${PATHS.sddConfig} не совпадает с Store metadata`);
      }
    } catch (error) {
      issues.push(`${PATHS.sddConfig}: ${error.message}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `needs_recovery: Store metadata существует, но sdd init не завершён: ${issues.join("; ")}. ` +
        "Автоматический ремонт не выполняется; файлы проекта не изменены",
    );
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
 * @returns {Promise<import("../shared/types.js").InitResult>}
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
    await assertInitializationComplete({
      projectRoot,
      storeId,
      metadata,
      bundleFiles,
      agent,
    });
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
  if (hasProjectFiles) await installOpenSpec(projectRoot, agent.openSpecId, commandRunner);
  setupStore(projectRoot, storeId, git.remote, commandRunner);
  if (!hasProjectFiles) await installOpenSpec(projectRoot, agent.openSpecId, commandRunner);
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
