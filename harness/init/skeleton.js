/** @fileoverview Инициализация OpenSpec Store через декларативный Project Template. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRepositoryId,
  assertSupportedOpenSpecVersion,
  parseOrchestratorConfig,
  parseStoreMetadata,
  sameGitRemote,
  serializeOrchestratorConfig,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { parseOpenSpecJson } from "../shared/openspec.js";
import { BASE_TEMPLATE_ROOT, buildTemplatePlan } from "../template/index.js";
import { inspectGit } from "./validation.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
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
  metadata: path.join(".openspec-store", "store.yaml"),
  openSpecConfig: path.join("openspec", "config.yaml"),
  alternateOpenSpecConfig: path.join("openspec", "config.yml"),
  orchestratorConfig: "openspec-orch.yaml",
  orchestratorTemplate: path.join(MODULE_ROOT, "openspec-orch.yaml"),
});

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние пути либо `null`.
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
 * Устанавливает официальный expanded agent pack без изменения профиля пользователя.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} agentAdapter Официальный OpenSpec adapter.
 * @param {typeof runCommand} commandRunner Исполнитель команд.
 * @returns {Promise<void>}
 */
async function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-openspec-profile-"));
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
 * Блокирует init, если путь уже зарегистрирован как Store.
 *
 * @param {string} projectRoot Корень Store.
 * @param {typeof runCommand} commandRunner Исполнитель команд.
 * @returns {void}
 */
function assertStorePathAvailable(projectRoot, commandRunner) {
  const registry = parseOpenSpecJson(
    commandRunner("openspec", ["store", "list", "--json"], { cwd: projectRoot }),
    "openspec store list --json",
  );
  const registrations = Array.isArray(registry.stores)
    ? registry.stores.filter(({ root }) => path.resolve(root ?? "") === projectRoot)
    : [];
  if (registrations.length === 0) return;
  const registeredIds = registrations.map(({ id }) => {
    assertRepositoryId(id, "Store ID в локальном registry OpenSpec");
    return id;
  });
  const commands = registeredIds
    .map((registeredId) => `openspec store unregister ${registeredId}`)
    .join("\n");
  throw new Error(
    `Локальный registry OpenSpec уже регистрирует путь ${projectRoot} как Store: ` +
      `${registeredIds.join(", ")}. Для чистого первого запуска выполните:\n${commands}\n` +
      "Команда unregister удаляет только локальную регистрацию и не удаляет файлы. " +
      "После этого повторите openspec-orch init",
  );
}

/**
 * Создаёт Store официальной командой OpenSpec и проверяет identity.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} storeId Store ID.
 * @param {string} remote Git URL Store.
 * @param {typeof runCommand} commandRunner Исполнитель команд.
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
 * Проверяет обязательный обычный файл.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} relativePath Относительный путь.
 * @param {string[]} issues Получатель диагностик.
 * @returns {Promise<void>}
 */
async function inspectRequiredFile(projectRoot, relativePath, issues) {
  const stat = await pathState(path.join(projectRoot, relativePath));
  if (!stat) issues.push(`отсутствует ${relativePath}`);
  else if (!stat.isFile() || stat.isSymbolicLink()) {
    issues.push(`${relativePath} не является обычным файлом`);
  }
}

/**
 * Проверяет завершённый init только по автономному runtime-контракту Core.
 * Исходный Template для повторного запуска не требуется.
 *
 * @param {object} options Параметры проверки.
 * @param {string} options.projectRoot Корень Store.
 * @param {string} options.storeId Ожидаемый Store ID.
 * @param {string} options.agentId Ожидаемый agent ID.
 * @param {{remote: string | undefined}} options.metadata Store metadata.
 * @returns {Promise<void>}
 */
async function assertInitializationComplete({ projectRoot, storeId, agentId, metadata }) {
  const issues = [];
  let config;
  const configStat = await pathState(path.join(projectRoot, PATHS.orchestratorConfig));
  if (!configStat?.isFile() || configStat.isSymbolicLink()) {
    issues.push(`отсутствует обычный файл ${PATHS.orchestratorConfig}`);
  } else {
    try {
      config = parseOrchestratorConfig(
        await fs.readFile(path.join(projectRoot, PATHS.orchestratorConfig), "utf8"),
      );
      assertSupportedOpenSpecVersion(config.openSpecVersion);
      if (config.storeRepository.id !== storeId) {
        issues.push(`Store ID в ${PATHS.orchestratorConfig} не совпадает с Store metadata`);
      }
      if (config.agent.id !== agentId) {
        issues.push(`agent в ${PATHS.orchestratorConfig} не совпадает с аргументом openspec-orch init`);
      }
      if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
        issues.push(`URL role: store в ${PATHS.orchestratorConfig} не совпадает с Store metadata`);
      }
    } catch (error) {
      issues.push(`${PATHS.orchestratorConfig}: ${error.message}`);
    }
  }

  if (config) {
    await inspectRequiredFile(projectRoot, config.agent.instructionsFile, issues);
    const commandsStat = await pathState(path.join(projectRoot, config.agent.commandsDirectory));
    if (!commandsStat?.isDirectory() || commandsStat.isSymbolicLink()) {
      issues.push(`${config.agent.commandsDirectory}/ не является обычным каталогом`);
    }
  }
  await inspectRequiredFile(projectRoot, PATHS.openSpecConfig, issues);
  for (const relativePath of ["openspec/specs", "openspec/changes/archive"]) {
    const stat = await pathState(path.join(projectRoot, relativePath));
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      issues.push(`${relativePath}/ не является обычным каталогом`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `needs_recovery: завершено: создана Store metadata; не завершено: ${issues.join("; ")}. ` +
      "Автоматический ремонт не выполняется; файлы проекта не изменены",
    );
  }
}

/**
 * Блокирует занятые до запуска agent-pack paths.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../template/types.js").TemplateAgent} agent Mapping выбранного агента.
 * @returns {Promise<void>}
 */
async function assertAgentPackPathsAvailable(projectRoot, agent) {
  for (const relativePath of new Set([agent.generatedDirectory, agent.targetDirectory])) {
    if (await pathState(path.join(projectRoot, relativePath))) {
      throw new Error(`Инициализации мешает существующий agent pack: ${relativePath}/`);
    }
  }
}

/**
 * Фиксирует существовавшие до запуска файлы plan и блокирует различающийся контент.
 *
 * @param {import("../template/types.js").TemplatePlanFile[]} files Copy plan.
 * @returns {Promise<Set<string>>} Пути идентичных файлов, которые не нужно менять.
 */
async function inspectPreExistingTemplateFiles(files) {
  const finalFiles = new Map();
  for (const file of files) finalFiles.set(file.targetRelative, file);
  const unchanged = new Set();
  for (const file of finalFiles.values()) {
    const stat = await pathState(file.target);
    if (!stat) continue;
    const [actual, expected] = await Promise.all([
      fs.readFile(file.target),
      fs.readFile(file.source),
    ]);
    if (!actual.equals(expected)) {
      throw new Error(`Инициализации мешает существующий файл с другим содержимым: ${file.targetRelative}`);
    }
    unchanged.add(file.targetRelative);
  }
  return unchanged;
}

/**
 * Повторно проверяет путь после внешнего OpenSpec init перед записью Template.
 *
 * @param {string} targetRoot Корень Store.
 * @param {string} relativePath Относительный путь назначения.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние конечного пути.
 */
async function inspectWritableTarget(targetRoot, relativePath) {
  let current = targetRoot;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await pathState(current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new Error(`Target содержит symlink: ${relativePath}`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`Target содержит file-directory collision: ${relativePath}`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`Target конфликтует с каталогом или специальным объектом: ${relativePath}`);
    }
    if (final) return stat;
  }
  return null;
}

/**
 * Переносит официальный agent pack в provider-specific каталог из Template mapping.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../template/types.js").TemplateAgent} agent Mapping выбранного агента.
 * @returns {Promise<void>}
 */
async function adaptGeneratedAgentPack(projectRoot, agent) {
  const source = path.join(projectRoot, agent.generatedDirectory);
  const sourceStat = await pathState(source);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`OpenSpec не создал ожидаемый agent pack ${agent.generatedDirectory}/`);
  }
  if (agent.generatedDirectory === agent.targetDirectory) return;
  const destination = path.join(projectRoot, agent.targetDirectory);
  if (await pathState(destination)) {
    throw new Error(`Нельзя перенести agent pack: уже существует ${agent.targetDirectory}/`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
}

/**
 * Применяет рассчитанный Template plan. Template имеет приоритет над файлами,
 * созданными OpenSpec в рамках текущего запуска.
 *
 * @param {object} options Параметры применения.
 * @param {string} options.projectRoot Корень Store.
 * @param {import("../template/types.js").TemplatePlanFile[]} options.files Copy plan.
 * @param {Set<string>} options.unchangedPreExisting Идентичные пользовательские файлы.
 * @returns {Promise<{created: string[], updated: string[]}>} Изменённые пути.
 */
async function applyTemplatePlan({ projectRoot, files, unchangedPreExisting }) {
  const created = new Set();
  const updated = new Set();
  for (const file of files) {
    if (unchangedPreExisting.has(file.targetRelative)) continue;
    const targetStat = await inspectWritableTarget(projectRoot, file.targetRelative);
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    await fs.copyFile(file.source, file.target);
    await fs.chmod(file.target, file.mode);
    if (!created.has(file.targetRelative) && !updated.has(file.targetRelative)) {
      if (targetStat) updated.add(file.targetRelative);
      else created.add(file.targetRelative);
    }
  }
  return { created: [...created].sort(), updated: [...updated].sort() };
}

/**
 * Один раз подготавливает центральный репозиторий как OpenSpec Store.
 *
 * @param {object} [options]
 * @param {string} [options.target] Корень центрального Git-репозитория.
 * @param {string} options.storeId Store ID.
 * @param {string} options.agentId Agent mapping из выбранного Template.
 * @param {string} [options.templateRoot] Локальный Template root; по умолчанию встроенный.
 * @param {Array<{id: string, role: "code", url: string, defaultBranch: string}>} [options.repositories]
 * @param {typeof runCommand} [options.commandRunner] Исполнитель внешних команд.
 * @returns {Promise<import("../shared/types.js").InitResult>}
 */
export async function initProject({
  target = ".",
  storeId,
  agentId,
  templateRoot = BASE_TEMPLATE_ROOT,
  repositories = [],
  commandRunner = runCommand,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  assertRepositoryId(agentId, "Agent ID");
  const requestedRoot = path.resolve(target);
  const rootStat = await pathState(requestedRoot);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`openspec-orch init требует существующий обычный каталог: ${requestedRoot}`);
  }
  const projectRoot = await fs.realpath(requestedRoot);
  if (await pathState(path.join(projectRoot, PATHS.alternateOpenSpecConfig))) {
    throw new Error(
      `${PATHS.alternateOpenSpecConfig} нужно перенести в ${PATHS.openSpecConfig} до openspec-orch init`,
    );
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
    await assertInitializationComplete({ projectRoot, storeId, agentId, metadata });
    return {
      target: projectRoot,
      storeId,
      alreadyInitialized: true,
      created: [],
      updated: [],
    };
  }

  if (await pathState(path.join(projectRoot, PATHS.orchestratorConfig))) {
    throw new Error(`Инициализации мешает существующий ${PATHS.orchestratorConfig}`);
  }
  const templatePlan = await buildTemplatePlan({ templateRoot, targetRoot: projectRoot, agentId });
  await assertAgentPackPathsAvailable(projectRoot, templatePlan.agent);
  const unchangedPreExisting = await inspectPreExistingTemplateFiles(templatePlan.files);

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
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: projectRoot });
  assertSupportedOpenSpecVersion(installedVersion);
  assertStorePathAvailable(projectRoot, commandRunner);
  const orchestratorContents = serializeOrchestratorConfig(
    await fs.readFile(PATHS.orchestratorTemplate, "utf8"),
    configuredRepositories,
    templatePlan.agent,
    installedVersion,
  );
  parseOrchestratorConfig(orchestratorContents);

  await installOpenSpec(projectRoot, templatePlan.agent.openSpecId, commandRunner);
  await adaptGeneratedAgentPack(projectRoot, templatePlan.agent);
  setupStore(projectRoot, storeId, git.remote, commandRunner);

  const installed = await applyTemplatePlan({
    projectRoot,
    files: templatePlan.files,
    unchangedPreExisting,
  });
  await fs.writeFile(
    path.join(projectRoot, PATHS.orchestratorConfig),
    orchestratorContents,
    { encoding: "utf8", flag: "wx" },
  );
  installed.created.push(PATHS.orchestratorConfig);

  const metadata = parseStoreMetadata(
    await fs.readFile(path.join(projectRoot, PATHS.metadata), "utf8"),
  );
  await assertInitializationComplete({ projectRoot, storeId, agentId, metadata });
  return {
    target: projectRoot,
    storeId,
    alreadyInitialized: false,
    created: [PATHS.metadata, ...installed.created.sort()],
    updated: installed.updated,
  };
}
