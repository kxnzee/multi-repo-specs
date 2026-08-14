/** @fileoverview Оркестрация read-only предпроверок для шага Explore. */

import path from "node:path";
import process from "node:process";

import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  requireAgentHandoff,
  resolveExecutionMode,
  sameGitRemote,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { readRelativeRegularFile } from "../shared/files.js";
import { inspectFreshCheckout } from "../shared/git.js";
import { assertOpenSpecRoot } from "../shared/openspec.js";
import { validateOpenSpec } from "../shared/store.js";
import { resolveWorkspace } from "../shared/workspace.js";
import {
  resolveCodeRepositories,
  validatePointer,
  validateSelection,
} from "./validation/repository.js";
import { validateOpenSpecAction } from "./validation/store.js";
import { findDuplicates, validateTicket } from "./validation/ticket.js";
import { resolveStart } from "./workspace.js";

export { validateTicket } from "./validation/ticket.js";

const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  orchestratorConfig: "openspec-orch.yaml",
});

/**
 * Читает обязательный обычный файл Store без перехода по symlink.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} relativePath Относительный путь.
 * @returns {Promise<string>} UTF-8 содержимое.
 */
const readStoreFile = readRelativeRegularFile;

/**
 * Проверяет Store и workspace и возвращает read-only-область будущего Explore.
 *
 * @param {object} [options] Параметры подготовки.
 * @param {string} [options.start] Текущий Store, его вложенный путь или Code Repository.
 * @param {string} [options.workspace] Явный корень multi-repo workspace.
 * @param {string} options.ticket Jira ticket key.
 * @param {(repositories: import("../shared/types.js").ResolvedRepository[]) => Promise<string[]> | string[]} options.selectRepositories
 * Интерактивный выбор Code Repositories.
 * @param {(changes: string[]) => Promise<boolean> | boolean} [options.confirmArchivedChange]
 * Подтверждение повторного Explore для архивного ticket.
 * @param {(message: string) => void} [options.onProgress] Пользовательский вывод прогресса.
 * @param {boolean} [options.noStrict] Отключить Git-гарантии для текущего вызова.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд; переопределяется в тестах.
 * @returns {Promise<import("../shared/types.js").ExplorePreparation>} Проверенная область.
 */
export async function prepareExplore({
  start = process.cwd(),
  workspace: requestedWorkspace,
  ticket,
  selectRepositories,
  confirmArchivedChange,
  onProgress = () => {},
  noStrict = false,
  commandRunner = runCommand,
} = {}) {
  validateTicket(ticket);
  if (typeof selectRepositories !== "function") {
    throw new Error("Для openspec-orch explore требуется интерактивный выбор репозиториев");
  }

  const startContext = await resolveStart(start, commandRunner);
  const projectRoot = startContext.projectRoot;
  const [metadataSource, configSource] = await Promise.all([
    readStoreFile(projectRoot, PATHS.metadata),
    readStoreFile(projectRoot, PATHS.orchestratorConfig),
  ]);
  const metadata = parseStoreMetadata(metadataSource);
  const config = parseOrchestratorConfig(configSource);
  const executionMode = resolveExecutionMode(config.strict, noStrict);
  const exploreInstructionsRelativePath = requireAgentHandoff(
    config.agent,
    "explore",
    "openspec-orch explore",
  );
  const exploreInstructionsPath = path.join(projectRoot, exploreInstructionsRelativePath);
  await readStoreFile(projectRoot, exploreInstructionsRelativePath);
  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в openspec-orch.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }

  await validateOpenSpecAction(projectRoot, config.agent);
  const activeChanges = validateOpenSpec(
    projectRoot,
    metadata.id,
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

  const workspace = await resolveWorkspace(
    projectRoot,
    metadata.id,
    requestedWorkspace,
    commandRunner,
    executionMode === "strict",
  );
  const available = await resolveCodeRepositories(
    workspace,
    config.codeRepositories,
    commandRunner,
    executionMode,
  );
  if (
    startContext.codeRoot &&
    !available.some(({ path: repositoryPath }) => repositoryPath === startContext.codeRoot)
  ) {
    throw new Error("Текущий Code Repository не зарегистрирован в openspec-orch.yaml этого Store");
  }

  const store = executionMode === "strict"
    ? inspectFreshCheckout(projectRoot, config.storeRepository, commandRunner)
    : { branch: "unpinned", revision: "unpinned" };
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
  for (const [index, repository] of selected.entries()) {
    const prefix = `[${index + 1}/${selected.length}] ${repository.id}`;
    onProgress(`${prefix}: проверка актуальности...`);
    const git = executionMode === "strict"
      ? inspectFreshCheckout(repository.path, repository, commandRunner)
      : { branch: "unpinned", revision: "unpinned" };
    await validatePointer(repository, metadata.id, projectRoot, commandRunner);
    repositories.push({ id: repository.id, path: repository.path, ...git });
    onProgress(`${prefix}: готово`);
  }

  return {
    ticket,
    projectRoot,
    storeRepositoryId: metadata.id,
    store,
    workspace,
    projectSpecsOnly: repositories.length === 0,
    repositories,
    exploreInstructionsPath,
    executionMode,
  };
}
