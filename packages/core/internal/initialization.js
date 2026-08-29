/** @fileoverview Доменный сценарий инициализации центрального OpenSpec Store. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { atomicWriter } from "./atomic-writer.js";
import { bundledAgents } from "./bundled-agent.js";
import { configuration } from "./configuration.js";
import {
  CORE_CONTRACT_VERSIONS,
  CORE_EXECUTION_MODE,
  CORE_FILES,
  CORE_PATTERNS,
} from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { git } from "./git.js";
import { openspec } from "./openspec.js";
import { Project } from "./project.js";
import { Repository } from "./repository.js";
import { CORE_SETTINGS } from "./settings.js";
import { StoreTarget } from "./store-target.js";
import { projectTemplates } from "./template.js";
import { deepFreeze, hasMethods } from "./value.js";

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
  #agentAdapter;
  #agents;
  #git;
  #openspec;
  #templates;

  constructor({
    agentAdapter,
    agentProvider = bundledAgents,
    configurationService = configuration,
    gitService = git,
    openSpecService = openspec,
    templateService = projectTemplates,
  } = {}) {
    const resolvedAdapter = agentAdapter ?? agentProvider?.adapter;
    if (!hasMethods(agentProvider, ["resolve"]) || !hasMethods(resolvedAdapter, ["adaptOpenSpecPack"])) {
      throw new Error(
        "INITIALIZATION_INVALID: agentProvider должен предоставлять resolve и Agent Adapter",
      );
    }
    this.#agentAdapter = resolvedAdapter;
    this.#agents = agentProvider;
    this.#configuration = configurationService;
    this.#git = gitService;
    this.#openspec = openSpecService;
    this.#templates = templateService;
    Object.freeze(this);
  }

  async initialize({
    target = ".",
    storeId,
    agentId,
    templateId,
    extensions,
    replaceExtensions,
    templateRoot,
    repositories = [],
    noStrict = false,
  } = {}) {
    this.#assertId(storeId, "Store ID");
    this.#assertId(agentId, "Agent ID");
    if (templateId !== undefined) this.#assertId(templateId, "Template ID");
    const agent = this.#agents.resolve(agentId);
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
      return this.#restoreExisting({
        storeTarget,
        agent,
        templateId,
        extensions,
        replaceExtensions: replaceExtensions ?? extensions !== undefined,
      });
    }
    return this.#initializeNew({
      storeTarget,
      agent,
      templateId,
      extensions: extensions ?? [],
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

  async #restoreExisting({
    storeTarget,
    agent,
    templateId,
    extensions,
    replaceExtensions,
  }) {
    const metadata = this.#configuration.parseStore(
      await fs.readFile(path.join(storeTarget.root, CORE_FILES.storeMetadata), "utf8"),
    );
    if (metadata.id !== storeTarget.id) {
      throw new Error(`Store уже инициализирован с ID ${metadata.id}, а не ${storeTarget.id}`);
    }
    const project = this.#configuration.parseProject(
      await fs.readFile(path.join(storeTarget.root, CORE_FILES.orchestratorConfig), "utf8"),
    );
    if (project.agent.id !== agent.id) {
      throw new Error(
        `STORE_AGENT_MISMATCH: Store зарегистрирован для ${project.agent.id}, а не ${agent.id}`,
      );
    }
    if (templateId !== undefined && project.template.id !== templateId) {
      throw new Error(
        `STORE_TEMPLATE_MISMATCH: Store создан из ${project.template.id}, а не ${templateId}`,
      );
    }
    let currentProject = project;
    const updated = [];
    if (extensions !== undefined) {
      const current = project.extensionDeclarations.map((entry) => entry.toConfig());
      const requestedExtensions = replaceExtensions
        ? extensions
        : [
            ...extensions,
            ...current.filter(({ id }) => !extensions.some((entry) => entry.id === id)),
          ];
      currentProject = new Project({ ...project.toConfig(), extensions: requestedExtensions });
      const requested = currentProject.extensionDeclarations.map((entry) => entry.toConfig());
      if (JSON.stringify(current) !== JSON.stringify(requested)) {
        await atomicWriter.write(
          path.join(storeTarget.root, CORE_FILES.orchestratorConfig),
          this.#configuration.serializeProject(currentProject),
        );
        updated.push(CORE_FILES.orchestratorConfig);
      }
    }
    await this.#assertComplete({ storeTarget, metadata, project: currentProject, agent });
    return this.#result({
      storeTarget,
      alreadyInitialized: true,
      strict: currentProject.strict,
      created: [],
      updated,
      agent,
    });
  }

  async #initializeNew({
    storeTarget,
    agent,
    templateId,
    extensions,
    templateRoot,
    codeRepositories,
    strict,
  }) {
    if (await lstatOrNull(path.join(storeTarget.root, CORE_FILES.orchestratorConfig))) {
      throw new Error(`Инициализации мешает существующий ${CORE_FILES.orchestratorConfig}`);
    }
    const templatePlan = await this.#templates.plan({
      templateRoot,
      targetRoot: storeTarget.root,
      agent,
    });
    if (templateId !== undefined && templatePlan.id !== templateId) {
      throw new Error(`TEMPLATE_ID_MISMATCH: ожидался ${templateId}, получен ${templatePlan.id}`);
    }
    await templatePlan.assertAgentPackPathsAvailable();
    const unchangedPreExisting = await templatePlan.inspectPreExistingFiles();
    const gitIdentity = await this.#inspectGit(storeTarget);
    const project = new Project({
      version: CORE_CONTRACT_VERSIONS.project,
      strict,
      template: { id: templatePlan.id },
      agent: { id: agent.id },
      extensions,
      plugins: [],
      repositories: [
        new Repository({
          id: storeTarget.id,
          role: REPOSITORY_ROLE.store,
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
      await this.#agentAdapter.adaptOpenSpecPack({
        agent: templatePlan.agent,
        targetRoot: storeTarget.root,
      });
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

  #result({
    storeTarget,
    alreadyInitialized,
    strict,
    created,
    updated,
    agent,
  }) {
    return deepFreeze({
      target: storeTarget.root,
      storeId: storeTarget.id,
      alreadyInitialized,
      executionMode: strict ? CORE_EXECUTION_MODE.strict : CORE_EXECUTION_MODE.relaxed,
      created: [...created],
      updated: [...updated],
      agent: agent.snapshot(),
    });
  }
}

/** Общий Initialization Service нового Core. */
export const initialization = Object.freeze(new InitializationService());
