/** @fileoverview Публичная граница нового Orchestrator Core. */

export { AtomicWriter, atomicWriter } from "./internal/atomic-writer.js";
export { CandidateCli } from "./internal/cli.js";
export { ConnectionResult, ConnectionService, RepositoryConnection, connection } from "./internal/connection.js";
export { RepositoryCheckout, createRepositoryCheckout } from "./internal/checkout.js";
export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { CoreState, CoreStateService, CoreStateStore, coreState } from "./internal/core-state.js";
export { FileService, RepositoryFiles, files } from "./internal/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./internal/git.js";
export { InitializationService, initialization } from "./internal/initialization.js";
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./internal/openspec.js";
export { OpenSpecPointerService, pointers } from "./internal/pointer.js";
export { FailClosedLock, locks } from "./internal/lock.js";
export { PluginContext, PluginContextFactory, pluginContexts } from "./internal/plugin-context.js";
export { PluginBindingChange, PluginBindingService, pluginBindings } from "./internal/plugin-binding.js";
export { PluginLifecycleCommands } from "./internal/plugin-cli.js";
export { PluginCommandBuilder, PluginCommandMounter, PluginCommandRegistry } from "./internal/plugin-commands.js";
export { PluginHost, PluginRegistry } from "./internal/plugin-host.js";
export { PluginConnectionResult, PluginLifecycleService, PluginStatusResult } from "./internal/plugin-lifecycle.js";
export { LoadedPlugin, PluginLoader, pluginLoader } from "./internal/plugin-loader.js";
export { PluginInstallation, PluginInstallerService, StorePluginInstaller, pluginInstallers } from "./internal/plugin-installer.js";
export { NpmPackageInstaller, NpmPackageInstallResult, npmPackageInstaller } from "./internal/npm-package-installer.js";
export { PluginPlatform } from "./internal/plugin-platform.js";
export { PluginSource } from "./internal/plugin-source.js";
export { PluginStorage, PluginStorageService, pluginStorage } from "./internal/plugin-storage.js";
export { ProcessService, ScopedProcess, processes } from "./internal/process.js";
export { Project, createProject } from "./internal/project.js";
export { Repository, createRepository } from "./internal/repository.js";
export { RepositoryRunner, RepositorySelector, repositoryRunner, repositorySelector } from "./internal/repository-operations.js";
export { RepositoryStatus, RepositoryStatusService, repositoryStatuses } from "./internal/repository-status.js";
export { Store, createStore } from "./internal/store.js";
export { StoreProject, StoreProjectService, storeProjects } from "./internal/store-project.js";
export { StoreTarget } from "./internal/store-target.js";
export {
  ProjectTemplateService,
  TemplateAgent,
  TemplatePlan,
  projectTemplates,
} from "./internal/template.js";
export { Workspace, WorkspaceResolver, workspace } from "./internal/workspace.js";

import { PluginPlatform } from "./internal/plugin-platform.js";

/** Создаёт candidate CLI с уже перенесёнными Core operations. */
export function createCandidateProgram({
  loadedPlugins,
  pluginCliOptions,
  pluginContextFactory,
  rootCommands,
  ...options
} = {}) {
  return new PluginPlatform({
    contextFactory: pluginContextFactory,
    loadedPlugins,
    pluginCliOptions,
    rootCommands,
  }).createProgram(options);
}
