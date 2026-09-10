/** @fileoverview Доменная модель Plugin и фабрика публичного API. */

import { executePluginCommands } from "./command-executor.js";
import { Extension, defineExtension } from "@openspec-orch/extension-sdk";
import { invalidPluginDefinition, normalizePluginDefinition } from "./plugin-definition.js";

/** @typedef {"store" | "code" | "specs"} RepositoryRole */

/**
 * @typedef {object} RepositoryHandle
 * @property {string} id
 * @property {RepositoryRole} role
 */

/**
 * @typedef {object} RepositoryRegistry
 * @property {() => readonly RepositoryHandle[]} list
 * @property {(id: string) => RepositoryHandle} require
 * @property {(id: string) => boolean} isConnected
 * @property {(ids: readonly string[]) => readonly RepositoryHandle[]} requireConnected
 * @property {(id: string) => Promise<GitFacade | null>} git
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
 * @property {(revision: string) => Promise<GitChanges>} changesSince
 * @property {(pathspec?: readonly string[]) => Promise<boolean>} isClean
 * @property {() => Promise<string>} revision
 * @property {(ancestor: string, descendant: string) => Promise<boolean>} isAncestor
 * @property {(pathspec: readonly string[]) => Promise<string>} latestRevision
 * @property {(revision?: string) => Promise<boolean>} isRemoteReachable
 * @property {(revision: string) => Promise<boolean>} hasCommit
 * @property {() => Promise<void>} assertNoOperation
 */

/**
 * Read-only сравнение всего Repository, без привязки файлов к задачам Plugin.
 * @typedef {object} GitChanges
 * @property {string} from_revision
 * @property {string} to_revision
 * @property {number} commit_count
 * @property {readonly string[]} committed_files
 * @property {readonly string[]} worktree_files
 */

/**
 * @typedef {object} OpenSpecFacade
 * @property {() => Promise<string>} version
 */

/**
 * @typedef {object} PluginRepositoryStatus
 * @property {string} state
 * @property {string} [details]
 */

/**
 * @typedef {object} FilesFacade
 * @property {(relativePath: string, options?: {optional?: boolean}) => Promise<string | null>} read
 * @property {(relativePath: string, options?: {optional?: boolean}) =>
 *   Promise<readonly string[]>} listFiles
 * @property {(relativePath: string, options?: {optional?: boolean}) =>
 *   Promise<readonly string[]>} listDirectories
 * @property {(relativePath: string, contents: string, options?: object) => Promise<void>} write
 */

/**
 * @typedef {object} ProcessFacade
 * @property {(executable: string, args: readonly string[], options?: {
 *   acceptedExitCodes?: readonly number[],
 *   environment?: Readonly<Record<string, string>>,
 *   onStderr?: (message: string) => void,
 *   sensitiveValues?: readonly string[]
 * }) => Promise<string>} run
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
 * @property {(definition: string) => CommandBuilder} command
 * @property {(flags: string, description: string, config?: {
 *   choices?: readonly string[],
 *   parser?: Function,
 *   required?: boolean
 * }) => CommandBuilder} option
 * @property {(handler: (...args: unknown[]) => unknown) => CommandBuilder} action
 * @property {(handler: (context: PluginContext, ...args: unknown[]) => unknown,
 *   config?: {scope?: "current" | "store", requireBinding?: boolean}) => CommandBuilder}
 *   actionWithContext
 */

/**
 * @typedef {object} CommandRegistry
 * @property {(definition: string) => CommandBuilder} command
 */

/**
 * @typedef {object} PluginContext
 * @property {Readonly<ProjectHandle>} project
 * @property {{readonly id: string, readonly repositories: readonly RepositoryHandle[]} | null} targetStore
 * @property {RepositoryRegistry} repositories
 * @property {RepositoryHandle} [repository]
 * @property {{readonly id: string, readonly role: RepositoryRole, readonly path: string} | null}
 *   invocation
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
 * @property {(context: PluginContext, args: readonly string[]) => unknown | Promise<unknown>} [exec]
 */

/**
 * @typedef {object} PluginDefinition
 * @property {string} id
 * @property {object} [agent]
 * @property {readonly RepositoryRole[]} [supports]
 * @property {RepositoryContribution} [repository]
 * @property {(context: PluginContext) => readonly (Extension | object)[]} [extensions]
 * @property {(commands: CommandRegistry) => void} [registerCommands]
 */

/** Доменная модель одного проверенного Plugin. */
export class Plugin {
  #id;
  #supports;
  #repository;
  #agentContribution;
  #extensionContribution;
  #commandRegistration;

  /** @param {PluginDefinition} definition Пользовательское определение Plugin. */
  constructor(definition) {
    const normalized = normalizePluginDefinition(definition);
    this.#id = normalized.id;
    this.#supports = normalized.supports;
    this.#repository = normalized.repository;
    this.#agentContribution = normalized.agent;
    this.#extensionContribution = normalized.extensions;
    this.#commandRegistration = normalized.registerCommands;
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

  canExec() {
    return this.#repository?.exec !== undefined || this.#commandRegistration !== undefined;
  }

  exec(context, args) {
    if (
      !Array.isArray(args) ||
      args.length === 0 ||
      args.some((argument) => typeof argument !== "string")
    ) {
      throw new Error("PLUGIN_EXEC_INVALID: args должен быть непустым массивом строк");
    }
    const immutableArgs = Object.freeze([...args]);
    if (this.#commandRegistration) {
      try {
        const result = executePluginCommands(this.#commandRegistration, context, immutableArgs);
        return result && typeof result.then === "function" ? result.then(() => undefined) : undefined;
      } catch (error) {
        if (error?.code !== "PLUGIN_EXEC_COMMAND_UNKNOWN" || !this.#repository?.exec) {
          return Promise.reject(error);
        }
      }
    }
    if (this.#repository?.exec) return this.#repository.exec(context, immutableArgs);
    throw new Error(`PLUGIN_EXEC_UNSUPPORTED: ${this.#id} не поддерживает exec`);
  }

  hasExtensionContribution() {
    return this.#extensionContribution !== undefined;
  }

  hasAgentContribution() {
    return this.#agentContribution !== undefined;
  }

  agentContribution() {
    if (!this.#agentContribution) {
      throw new Error(`PLUGIN_AGENT_UNSUPPORTED: ${this.#id} не предоставляет Agent contribution`);
    }
    return this.#agentContribution;
  }

  extensions(context) {
    if (!this.#extensionContribution) {
      throw new Error(`PLUGIN_EXTENSIONS_UNSUPPORTED: ${this.#id} не предоставляет Extensions`);
    }
    const definitions = this.#extensionContribution(context);
    if (!Array.isArray(definitions)) {
      invalidPluginDefinition("extensions должен вернуть массив");
    }
    const extensions = definitions.map((definition) => (
      definition instanceof Extension ? definition : defineExtension(definition)
    ));
    if (new Set(extensions.map(({ id }) => id)).size !== extensions.length) {
      invalidPluginDefinition("extensions содержит повторяющийся id");
    }
    return Object.freeze(extensions);
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
