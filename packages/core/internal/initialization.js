/** @fileoverview Доменный сценарий инициализации центрального OpenSpec Store. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { configuration } from "./configuration.js";
import { CORE_CONTRACT_VERSIONS, CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { git } from "./git.js";
import { openspec } from "./openspec.js";
import { Project } from "./project.js";
import { Repository } from "./repository.js";
import { CORE_SETTINGS } from "./settings.js";
import { StoreTarget } from "./store-target.js";
import { projectTemplates } from "./template.js";
import { deepFreeze } from "./value.js";

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Сравнивает Git remotes без незначимых завершающих slash. */
function sameGitRemote(left, right) {
  const normalize = (value) => value.trim().replace(CORE_PATTERNS.trailingSlashes, "");
  return normalize(left) === normalize(right);
}

/** Проверяет обязательный обычный init file. */
async function inspectRequiredFile(projectRoot, relativePath, issues) {
  const stat = await lstatOrNull(path.join(projectRoot, relativePath));
  if (!stat) issues.push(`отсутствует ${relativePath}`);
  else if (!stat.isFile() || stat.isSymbolicLink()) {
    issues.push(`${relativePath} не является обычным файлом`);
  }
}

/** Оркестрирует Core-owned init через доменные модели и ограниченные facades. */
export class InitializationService {
  #configuration;
  #git;
  #openspec;
  #templates;
  #writer;

  constructor({
    configurationService = configuration,
    gitService = git,
    openSpecService = openspec,
    templateService = projectTemplates,
    writer = atomicWriter,
  } = {}) {
    this.#configuration = configurationService;
    this.#git = gitService;
    this.#openspec = openSpecService;
    this.#templates = templateService;
    this.#writer = writer;
    Object.freeze(this);
  }

  async initialize({
    target = ".",
    storeId,
    agentId,
    templateRoot,
    repositories = [],
    noStrict = false,
  } = {}) {
    this.#assertId(storeId, "Store ID");
    this.#assertId(agentId, "Agent ID");
    const storeTarget = await this.#resolveTarget(storeId, target);
    const strict = noStrict ? false : CORE_SETTINGS.execution.strictByDefault;
    if (await lstatOrNull(path.join(storeTarget.root, CORE_FILES.alternateOpenSpecConfig))) {
      throw new Error(
        `${CORE_FILES.alternateOpenSpecConfig} нужно перенести в ` +
          `${CORE_FILES.openSpecConfig} до openspec-orch init`,
      );
    }
    const codeRepositories = repositories.map((repository) => (
      repository instanceof Repository ? repository : new Repository({ ...repository, plugins: [] })
    ));
    const ids = new Set([storeId]);
    for (const repository of codeRepositories) {
      if (!repository.isCode()) {
        throw new Error(`Repository ${repository.id} для init должен иметь role code`);
      }
      if (ids.has(repository.id)) throw new Error(`Повторяющийся repository-id: ${repository.id}`);
      ids.add(repository.id);
    }

    const metadataStat = await lstatOrNull(path.join(storeTarget.root, CORE_FILES.storeMetadata));
    if (metadataStat && (!metadataStat.isFile() || metadataStat.isSymbolicLink())) {
      throw new Error(`${CORE_FILES.storeMetadata} должна быть обычным файлом`);
    }
    if (metadataStat) {
      return this.#restoreExisting({ storeTarget, agentId, templateRoot });
    }
    return this.#initializeNew({
      storeTarget,
      agentId,
      templateRoot,
      codeRepositories,
      strict,
    });
  }

  async #resolveTarget(storeId, target) {
    const requestedRoot = path.resolve(target);
    const stat = await lstatOrNull(requestedRoot);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`openspec-orch init требует существующий обычный каталог: ${requestedRoot}`);
    }
    return new StoreTarget(storeId, await fs.realpath(requestedRoot));
  }

  async #restoreExisting({ storeTarget, agentId, templateRoot }) {
    const metadata = this.#configuration.parseStore(
      await fs.readFile(path.join(storeTarget.root, CORE_FILES.storeMetadata), "utf8"),
    );
    if (metadata.id !== storeTarget.id) {
      throw new Error(`Store уже инициализирован с ID ${metadata.id}, а не ${storeTarget.id}`);
    }
    const project = this.#configuration.parseProject(
      await fs.readFile(path.join(storeTarget.root, CORE_FILES.orchestratorConfig), "utf8"),
    );
    if (project.agents.length > 0 && !project.agents.includes(agentId)) {
      throw new Error(
        `STORE_AGENT_MISMATCH: Store зарегистрирован для ` +
          `${project.agents.join(", ")}, а не ${agentId}`,
      );
    }
    const templatePlan = await this.#templates.plan({
      templateRoot,
      targetRoot: storeTarget.root,
      agentId,
    });
    await this.#assertComplete({ storeTarget, metadata, project, agent: templatePlan.agent });
    const updated = [];
    if (project.registerAgent(agentId)) {
      await this.#inspectGit(storeTarget);
      await this.#writer.write(
        path.join(storeTarget.root, CORE_FILES.orchestratorConfig),
        this.#configuration.serializeProject(project),
      );
      updated.push(CORE_FILES.orchestratorConfig);
    }
    return this.#result({
      storeTarget,
      alreadyInitialized: true,
      strict: project.strict,
      created: [],
      updated,
      agent: templatePlan.agent,
    });
  }

  async #initializeNew({ storeTarget, agentId, templateRoot, codeRepositories, strict }) {
    if (await lstatOrNull(path.join(storeTarget.root, CORE_FILES.orchestratorConfig))) {
      throw new Error(`Инициализации мешает существующий ${CORE_FILES.orchestratorConfig}`);
    }
    const templatePlan = await this.#templates.plan({
      templateRoot,
      targetRoot: storeTarget.root,
      agentId,
    });
    await templatePlan.assertAgentPackPathsAvailable();
    const unchangedPreExisting = await templatePlan.inspectPreExistingFiles();
    const gitIdentity = await this.#inspectGit(storeTarget);
    const project = new Project({
      version: CORE_CONTRACT_VERSIONS.project,
      strict,
      agents: [agentId],
      plugins: [],
      repositories: [
        new Repository({
          id: storeTarget.id,
          role: "store",
          remote: gitIdentity.remote,
          defaultBranch: gitIdentity.defaultBranch,
          plugins: [],
        }),
        ...codeRepositories,
      ],
    });
    const orchestratorContents = this.#configuration.serializeProject(project);
    const openSpec = this.#openspec.forStoreTarget(storeTarget);
    await openSpec.version();
    await openSpec.assertStorePathAvailable();
    const openSpecConfigExisted = Boolean(
      await lstatOrNull(path.join(storeTarget.root, CORE_FILES.openSpecConfig)),
    );
    try {
      await openSpec.installAgentPack(templatePlan.agent.openSpecId);
      await templatePlan.adaptGeneratedAgentPack();
      await openSpec.setupStore(gitIdentity.remote);
    } catch (error) {
      const metadataCreated = Boolean(
        await lstatOrNull(path.join(storeTarget.root, CORE_FILES.storeMetadata)),
      );
      if (!metadataCreated) {
        await templatePlan.cleanupGeneratedAgentPack();
        if (!openSpecConfigExisted) {
          await fs.rm(path.join(storeTarget.root, CORE_FILES.openSpecConfig), { force: true });
        }
      }
      throw error;
    }
    const installed = await templatePlan.apply(unchangedPreExisting);
    await fs.writeFile(
      path.join(storeTarget.root, CORE_FILES.orchestratorConfig),
      orchestratorContents,
      { encoding: "utf8", flag: "wx" },
    );
    const metadata = this.#configuration.parseStore(
      await fs.readFile(path.join(storeTarget.root, CORE_FILES.storeMetadata), "utf8"),
    );
    await this.#assertComplete({ storeTarget, metadata, project, agent: templatePlan.agent });
    return this.#result({
      storeTarget,
      alreadyInitialized: false,
      strict,
      created: [
        CORE_FILES.storeMetadata,
        ...[...installed.created, CORE_FILES.orchestratorConfig].sort(),
      ],
      updated: installed.updated,
      agent: templatePlan.agent,
    });
  }

  async #inspectGit(storeTarget) {
    const repositoryGit = this.#git.forStoreTarget(storeTarget);
    const gitRoot = await repositoryGit.repositoryRoot();
    if (gitRoot !== storeTarget.root) {
      throw new Error("openspec-orch init нужно запускать из корня центрального Git-репозитория");
    }
    if (!await repositoryGit.isClean()) {
      throw new Error("openspec-orch init требует чистое рабочее дерево Git");
    }
    const remote = await repositoryGit.originUrl();
    const defaultBranch = await repositoryGit.currentBranch();
    if (!defaultBranch) throw new Error("openspec-orch init нельзя запускать в detached HEAD");
    return { remote, defaultBranch };
  }

  async #assertComplete({ storeTarget, metadata, project, agent }) {
    const issues = [];
    if (project.storeRepository.id !== storeTarget.id) {
      issues.push(`Store ID в ${CORE_FILES.orchestratorConfig} не совпадает с Store metadata`);
    }
    if (!metadata.remote || !sameGitRemote(project.storeRepository.remote, metadata.remote)) {
      issues.push(`URL role: store в ${CORE_FILES.orchestratorConfig} не совпадает с Store metadata`);
    }
    await inspectRequiredFile(storeTarget.root, agent.instructionsFile, issues);
    const commandsStat = await lstatOrNull(path.join(storeTarget.root, agent.commandsDirectory));
    if (!commandsStat?.isDirectory() || commandsStat.isSymbolicLink()) {
      issues.push(`${agent.commandsDirectory}/ не является обычным каталогом`);
    }
    await inspectRequiredFile(storeTarget.root, CORE_FILES.openSpecConfig, issues);
    for (const relativePath of [
      CORE_FILES.openSpecSpecsDirectory,
      CORE_FILES.openSpecArchiveDirectory,
    ]) {
      const stat = await lstatOrNull(path.join(storeTarget.root, relativePath));
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

  #assertId(value, label) {
    if (typeof value !== "string" || !CORE_PATTERNS.id.test(value)) {
      throw new Error(`${label} должен быть в lowercase kebab-case`);
    }
  }

  #result({ storeTarget, alreadyInitialized, strict, created, updated, agent }) {
    return deepFreeze({
      target: storeTarget.root,
      storeId: storeTarget.id,
      alreadyInitialized,
      executionMode: strict ? "strict" : "relaxed",
      created: [...created],
      updated: [...updated],
      agent: agent.snapshot(),
    });
  }
}

/** Общий Initialization Service нового Core. */
export const initialization = Object.freeze(new InitializationService());
