/** @fileoverview Оркестрация инициализации центрального OpenSpec Store. */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  serializeOrchestratorConfig,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { lstatOrNull } from "../shared/files.js";
import { assertRepositoryId } from "../shared/schema.js";
import { BASE_TEMPLATE_ROOT, buildTemplatePlan } from "../template/index.js";
import {
  adaptGeneratedAgentPack,
  applyTemplatePlan,
  assertAgentPackPathsAvailable,
  inspectPreExistingTemplateFiles,
} from "./installer.js";
import {
  assertStorePathAvailable,
  installOpenSpec,
  setupStore,
} from "./openspec.js";
import {
  assertInitializationComplete,
  INIT_PATHS,
} from "./preflight.js";
import { inspectGit } from "./validation.js";

/**
 * Один раз подготавливает центральный репозиторий как OpenSpec Store.
 *
 * @param {object} [options]
 * @param {string} [options.target] Корень центрального Git-репозитория.
 * @param {string} options.storeId Store ID.
 * @param {string} options.agentId Agent mapping из выбранного Template.
 * @param {string} [options.templateRoot] Локальный Template root; по умолчанию встроенный.
 * @param {Array<{id: string, role: "code", url: string, defaultBranch: string}>} [options.repositories]
 * @param {boolean} [options.noStrict] Сохранить relaxed mode как project default.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель внешних команд.
 * @returns {Promise<import("../shared/types.js").InitResult>}
 */
export async function initProject({
  target = ".",
  storeId,
  agentId,
  templateRoot = BASE_TEMPLATE_ROOT,
  repositories = [],
  noStrict = false,
  commandRunner = runCommand,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  assertRepositoryId(agentId, "Agent ID");
  const requestedRoot = path.resolve(target);
  const rootStat = await lstatOrNull(requestedRoot);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`openspec-orch init требует существующий обычный каталог: ${requestedRoot}`);
  }
  const projectRoot = await fs.realpath(requestedRoot);
  if (await lstatOrNull(path.join(projectRoot, INIT_PATHS.alternateOpenSpecConfig))) {
    throw new Error(
      `${INIT_PATHS.alternateOpenSpecConfig} нужно перенести в ` +
        `${INIT_PATHS.openSpecConfig} до openspec-orch init`,
    );
  }

  const ids = new Set([storeId]);
  for (const repository of repositories) {
    assertRepositoryId(repository.id);
    if (ids.has(repository.id)) throw new Error(`Повторяющийся repository-id: ${repository.id}`);
    ids.add(repository.id);
  }

  const metadataStat = await lstatOrNull(path.join(projectRoot, INIT_PATHS.metadata));
  if (metadataStat && (!metadataStat.isFile() || metadataStat.isSymbolicLink())) {
    throw new Error(`${INIT_PATHS.metadata} должна быть обычным файлом`);
  }
  if (metadataStat) {
    const metadata = parseStoreMetadata(
      await fs.readFile(path.join(projectRoot, INIT_PATHS.metadata), "utf8"),
    );
    if (metadata.id !== storeId) {
      throw new Error(`Store уже инициализирован с ID ${metadata.id}, а не ${storeId}`);
    }
    const config = await assertInitializationComplete({ projectRoot, storeId, agentId, metadata });
    return {
      target: projectRoot,
      storeId,
      alreadyInitialized: true,
      executionMode: config.strict ? "strict" : "relaxed",
      created: [],
      updated: [],
    };
  }

  if (await lstatOrNull(path.join(projectRoot, INIT_PATHS.orchestratorConfig))) {
    throw new Error(`Инициализации мешает существующий ${INIT_PATHS.orchestratorConfig}`);
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
  await inspectOpenSpecCli(commandRunner, projectRoot);
  await assertStorePathAvailable(projectRoot, commandRunner);
  const orchestratorContents = serializeOrchestratorConfig(
    await fs.readFile(INIT_PATHS.orchestratorTemplate, "utf8"),
    configuredRepositories,
    templatePlan.agent,
    !noStrict,
  );
  parseOrchestratorConfig(orchestratorContents);

  await installOpenSpec(projectRoot, templatePlan.agent.openSpecId, commandRunner);
  await adaptGeneratedAgentPack(projectRoot, templatePlan.agent);
  await setupStore(projectRoot, storeId, git.remote, commandRunner);

  const installed = await applyTemplatePlan({
    projectRoot,
    files: templatePlan.files,
    unchangedPreExisting,
  });
  await fs.writeFile(
    path.join(projectRoot, INIT_PATHS.orchestratorConfig),
    orchestratorContents,
    { encoding: "utf8", flag: "wx" },
  );
  installed.created.push(INIT_PATHS.orchestratorConfig);

  const metadata = parseStoreMetadata(
    await fs.readFile(path.join(projectRoot, INIT_PATHS.metadata), "utf8"),
  );
  await assertInitializationComplete({ projectRoot, storeId, agentId, metadata });
  return {
    target: projectRoot,
    storeId,
    alreadyInitialized: false,
    executionMode: noStrict ? "relaxed" : "strict",
    created: [INIT_PATHS.metadata, ...installed.created.sort()],
    updated: installed.updated,
  };
}

export { parseRepository } from "./validation.js";
