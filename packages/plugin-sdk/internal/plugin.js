/** @fileoverview Доменная модель Plugin и фабрика публичного API. */

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPOSITORY_ROLES = new Set(["store", "code"]);

/** @typedef {"store" | "code"} RepositoryRole */

/**
 * @typedef {object} RepositoryHandle
 * @property {string} id
 * @property {RepositoryRole} role
 */

/**
 * @typedef {object} RepositoryRegistry
 * @property {() => readonly RepositoryHandle[]} list
 * @property {(id: string) => RepositoryHandle} require
 * @property {(ids: readonly string[]) => readonly RepositoryHandle[]} requireConnected
 */

/**
 * @typedef {object} ProjectHandle
 * @property {string} id
 * @property {boolean} strict
 * @property {RepositoryHandle} store
 * @property {readonly RepositoryHandle[]} repositories
 * @property {{readonly id: string}} agent
 */

/**
 * @typedef {object} GitFacade
 * @property {() => Promise<string>} currentBranch
 * @property {(pathspec?: readonly string[]) => Promise<readonly string[]>} statusPaths
 * @property {(pathspec?: readonly string[]) => Promise<boolean>} isClean
 * @property {() => Promise<string>} revision
 */

/** @typedef {{version: () => Promise<string>}} OpenSpecFacade */

/**
 * @typedef {object} PluginRepositoryStatus
 * @property {string} state
 * @property {string} [details]
 */

/**
 * @typedef {object} FilesFacade
 * @property {(relativePath: string) => Promise<string>} read
 * @property {(relativePath: string, contents: string, options?: object) => Promise<void>} write
 */

/**
 * @typedef {object} ProcessFacade
 * @property {(executable: string, args: readonly string[], options?: object) => Promise<string>} run
 */

/**
 * @typedef {object} StorageFacade
 * @property {() => Promise<unknown>} read
 * @property {(data: unknown) => Promise<unknown>} write
 * @property {(operation: (current: unknown) => unknown | Promise<unknown>) => Promise<unknown>} update
 */

/**
 * @typedef {object} LoggerFacade
 * @property {(message: string) => void} info
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 */

/**
 * @typedef {object} CommandBuilder
 * Action получает позиционные аргументы и immutable options без Commander instance.
 * @property {(description: string) => CommandBuilder} description
 * @property {(handler: (...args: unknown[]) => unknown) => CommandBuilder} action
 */

/**
 * @typedef {object} CommandRegistry
 * @property {(definition: string) => CommandBuilder} command
 */

/**
 * @typedef {object} PluginContext
 * @property {Readonly<ProjectHandle>} project
 * @property {RepositoryRegistry} repositories
 * @property {RepositoryHandle} [repository]
 * @property {GitFacade} git
 * @property {OpenSpecFacade} openspec
 * @property {FilesFacade} files
 * @property {ProcessFacade} process
 * @property {StorageFacade} storage
 * @property {{readonly id: string}} agent
 * @property {LoggerFacade} logger
 */

/**
 * @typedef {object} RepositoryContribution
 * @property {(context: PluginContext) => unknown | Promise<unknown>} connect
 * @property {(context: PluginContext) => PluginRepositoryStatus | Promise<PluginRepositoryStatus>} status
 * @property {(context: PluginContext) => unknown | Promise<unknown>} [sync]
 */

/**
 * @typedef {object} AgentContribution
 * @property {(context: PluginContext) => unknown | Promise<unknown>} integration
 */

/**
 * @typedef {object} PluginDefinition
 * @property {string} id
 * @property {readonly RepositoryRole[]} supports
 * @property {RepositoryContribution} [repository]
 * @property {AgentContribution} [agent]
 * @property {(commands: CommandRegistry) => void} [registerCommands]
 */

/** Завершает проверку Plugin definition стабильной ошибкой SDK. */
function invalid(message) {
  throw new Error(`PLUGIN_DEFINITION_INVALID: ${message}`);
}

/** Проверяет plain object пользовательского definition. */
function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} должен быть plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} должен быть plain object`);
  }
}

/** Запрещает неизвестные поля публичного контракта. */
function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} содержит неизвестное поле '${key}'`);
  }
}

/** Проверяет callback одного contribution. */
function assertCallback(value, label) {
  if (typeof value !== "function") invalid(`${label} должен быть функцией`);
}

/** Проверяет и копирует Repository contribution. */
function repositoryContribution(repository) {
  if (repository === undefined) return undefined;
  assertPlainObject(repository, "repository");
  assertKnownKeys(repository, new Set(["connect", "status", "sync"]), "repository");
  assertCallback(repository.connect, "repository.connect");
  assertCallback(repository.status, "repository.status");
  if (repository.sync !== undefined) assertCallback(repository.sync, "repository.sync");
  return Object.freeze({
    connect: repository.connect,
    status: repository.status,
    ...(repository.sync === undefined ? {} : { sync: repository.sync }),
  });
}

/** Проверяет и копирует Agent contribution. */
function agentContribution(agent) {
  if (agent === undefined) return undefined;
  assertPlainObject(agent, "agent");
  assertKnownKeys(agent, new Set(["integration"]), "agent");
  assertCallback(agent.integration, "agent.integration");
  return Object.freeze({ integration: agent.integration });
}

/** Доменная модель одного проверенного Plugin. */
export class Plugin {
  #id;
  #supports;
  #repository;
  #agent;
  #commandRegistration;

  /** @param {PluginDefinition} definition Пользовательское определение Plugin. */
  constructor(definition) {
    assertPlainObject(definition, "Plugin definition");
    assertKnownKeys(
      definition,
      new Set(["id", "supports", "repository", "agent", "registerCommands"]),
      "Plugin definition",
    );
    if (typeof definition.id !== "string" || !PLUGIN_ID_PATTERN.test(definition.id)) {
      invalid("id должен быть lowercase kebab-case");
    }
    if (!Array.isArray(definition.supports)) invalid("supports должен быть массивом");
    const supports = [...definition.supports];
    if (supports.some((role) => !REPOSITORY_ROLES.has(role))) {
      invalid("supports содержит неизвестную Repository role");
    }
    if (new Set(supports).size !== supports.length) {
      invalid("supports содержит повторяющуюся role");
    }

    const repository = repositoryContribution(definition.repository);
    const agent = agentContribution(definition.agent);
    if (repository && supports.length === 0) {
      invalid("repository contribution требует хотя бы одну supports role");
    }
    if (!repository && supports.length > 0) {
      invalid("supports разрешён только вместе с repository contribution");
    }
    if (definition.registerCommands !== undefined) {
      assertCallback(definition.registerCommands, "registerCommands");
    }
    if (!repository && !agent && definition.registerCommands === undefined) {
      invalid("Plugin должен объявить хотя бы один contribution");
    }

    this.#id = definition.id;
    this.#supports = Object.freeze(supports);
    this.#repository = repository;
    this.#agent = agent;
    this.#commandRegistration = definition.registerCommands;
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get supports() {
    return this.#supports;
  }

  supportsRole(role) {
    return this.#supports.includes(role);
  }

  assertSupports(repository) {
    if (!this.supportsRole(repository.role)) {
      throw new Error(
        `PLUGIN_SCOPE_UNSUPPORTED: ${this.#id} не поддерживает role ` +
          `${repository.role} (${repository.id})`,
      );
    }
  }

  hasRepositoryContribution() {
    return this.#repository !== undefined;
  }

  connect(context) {
    return this.#requireRepositoryContribution("connect").connect(context);
  }

  status(context) {
    return this.#requireRepositoryContribution("status").status(context);
  }

  canSync() {
    return this.#repository?.sync !== undefined;
  }

  sync(context) {
    const repository = this.#requireRepositoryContribution("sync");
    if (!repository.sync) {
      throw new Error(`PLUGIN_SYNC_UNSUPPORTED: ${this.#id} не поддерживает sync`);
    }
    return repository.sync(context);
  }

  hasAgentContribution() {
    return this.#agent !== undefined;
  }

  integrateAgent(context) {
    if (!this.#agent) {
      throw new Error(`PLUGIN_AGENT_UNSUPPORTED: ${this.#id} не предоставляет Agent integration`);
    }
    return this.#agent.integration(context);
  }

  hasCommandContribution() {
    return this.#commandRegistration !== undefined;
  }

  registerCommands(commands) {
    if (!this.#commandRegistration) {
      throw new Error(`PLUGIN_COMMANDS_UNSUPPORTED: ${this.#id} не предоставляет CLI commands`);
    }
    return this.#commandRegistration(commands);
  }

  #requireRepositoryContribution(operation) {
    if (!this.#repository) {
      throw new Error(
        `PLUGIN_REPOSITORY_UNSUPPORTED: ${this.#id} не предоставляет repository.${operation}`,
      );
    }
    return this.#repository;
  }
}

/** Создаёт проверенную доменную модель Plugin, не запуская contributions. */
export function definePlugin(definition) {
  return new Plugin(definition);
}
