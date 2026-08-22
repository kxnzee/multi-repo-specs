/** @fileoverview Оркестрация инициализации центрального OpenSpec Store. */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  serializeNormalizedOrchestratorConfig,
  serializeOrchestratorConfig,
} from "../config/index.js";
import { PROJECT_SETTINGS } from "../config/settings.js";
import { runCommand } from "../shared/command.js";
import { inspectOpenSpecCli } from "../shared/compatibility.js";
import { lstatOrNull, writeFileAtomic } from "../shared/files.js";
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
 * @param {Array<{id: string, role: "code", remote: string, defaultBranch: string}>} [options.repositories]
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
  const strict = noStrict ? false : PROJECT_SETTINGS.execution.strictByDefault;
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
    const registeredConfig = parseOrchestratorConfig(
      await fs.readFile(path.join(projectRoot, INIT_PATHS.orchestratorConfig), "utf8"),
    );
    if (registeredConfig.agents.length > 0 && !registeredConfig.agents.includes(agentId)) {
      throw new Error(
        `STORE_AGENT_MISMATCH: Store зарегистрирован для ` +
          `${registeredConfig.agents.join(", ")}, а не ${agentId}`,
      );
    }
    const existingTemplatePlan = await buildTemplatePlan({ templateRoot, targetRoot: projectRoot, agentId });
    const config = await assertInitializationComplete({
      projectRoot,
      storeId,
      agent: existingTemplatePlan.agent,
      metadata,
    });
    const updated = [];
    if (config.agents.length === 0) {
      await inspectGit(projectRoot, commandRunner);
      await writeFileAtomic(
        path.join(projectRoot, INIT_PATHS.orchestratorConfig),
        serializeNormalizedOrchestratorConfig({ ...config, agents: [agentId] }),
      );
      updated.push(INIT_PATHS.orchestratorConfig);
    }
    return {
      target: projectRoot,
      storeId,
      alreadyInitialized: true,
      executionMode: config.strict ? "strict" : "relaxed",
      created: [],
      updated,
      agent: existingTemplatePlan.agent,
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
      remote: git.remote,
      defaultBranch: git.defaultBranch,
    },
    ...repositories,
  ];
  await inspectOpenSpecCli(commandRunner, projectRoot);
  await assertStorePathAvailable(projectRoot, commandRunner);
  const orchestratorContents = serializeOrchestratorConfig(
    await fs.readFile(INIT_PATHS.orchestratorTemplate, "utf8"),
    configuredRepositories,
    { strict, agents: [agentId] },
  );
  parseOrchestratorConfig(orchestratorContents);

  const openSpecConfigExisted = Boolean(
    await lstatOrNull(path.join(projectRoot, INIT_PATHS.openSpecConfig)),
  );
  try {
    await installOpenSpec(projectRoot, templatePlan.agent.openSpecId, commandRunner);
    await adaptGeneratedAgentPack(projectRoot, templatePlan.agent);
    await setupStore(projectRoot, storeId, git.remote, commandRunner);
  } catch (error) {
    const metadataCreated = Boolean(
      await lstatOrNull(path.join(projectRoot, INIT_PATHS.metadata)),
    );
    if (!metadataCreated) {
      for (const relativePath of new Set([
        templatePlan.agent.generatedDirectory,
        templatePlan.agent.targetDirectory,
      ])) {
        await fs.rm(path.join(projectRoot, relativePath), { recursive: true, force: true });
      }
      if (!openSpecConfigExisted) {
        await fs.rm(path.join(projectRoot, INIT_PATHS.openSpecConfig), { force: true });
      }
    }
    throw error;
  }

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
  await assertInitializationComplete({ projectRoot, storeId, agent: templatePlan.agent, metadata });
  return {
    target: projectRoot,
    storeId,
    alreadyInitialized: false,
    executionMode: strict ? "strict" : "relaxed",
    created: [INIT_PATHS.metadata, ...installed.created.sort()],
    updated: installed.updated,
    agent: templatePlan.agent,
  };
}

export { parseRepository } from "./validation.js";
