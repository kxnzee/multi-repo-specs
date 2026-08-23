/** @fileoverview Публичная граница нового Orchestrator Core. */

export { AtomicWriter, atomicWriter } from "./internal/atomic-writer.js";
export {
  BundledPluginPackage,
  BundledPluginProvider,
  bundledPlugins,
} from "./internal/bundled-plugin.js";
export { CandidateCli } from "./internal/cli.js";
export { ConnectionResult, ConnectionService, RepositoryConnection, connection } from "./internal/connection.js";
export { RepositoryCheckout, createRepositoryCheckout } from "./internal/checkout.js";
export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { CoreState, CoreStateService, CoreStateStore, coreState } from "./internal/core-state.js";
export { CurrentRepositoryService, currentRepositories } from "./internal/current-repository.js";
export { FileService, RepositoryFiles, files } from "./internal/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./internal/git.js";
export { InitializationService, initialization } from "./internal/initialization.js";
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./internal/openspec.js";
export { OpenSpecPointerService, pointers } from "./internal/pointer.js";
export { FailClosedLock, locks } from "./internal/lock.js";
export { PluginContext, PluginContextFactory, pluginContexts } from "./internal/plugin-context.js";
export { PluginDeclaration } from "./internal/plugin-declaration.js";
export {
  PluginBindingChange,
  PluginApplicationResult,
  PluginApplicationService,
  PluginRemovalResult,
  pluginApplications,
} from "./internal/plugin-application.js";
export { PluginLifecycleCommands } from "./internal/plugin-cli.js";
export { PluginCatalog, PluginCatalogEntry, pluginCatalog } from "./internal/plugin-catalog.js";
export { PluginCommandBuilder, PluginCommandMounter, PluginCommandRegistry } from "./internal/plugin-commands.js";
export { PluginHost, PluginRegistry } from "./internal/plugin-host.js";
export {
  PluginConnectionResult,
  PluginDisconnectionResult,
  PluginLifecycleService,
  PluginStatusResult,
} from "./internal/plugin-lifecycle.js";
export { LoadedPlugin, PluginLoader, pluginLoader } from "./internal/plugin-loader.js";
export { PluginInstallation } from "./internal/plugin-installation.js";
export {
  PluginManagerService,
  StorePluginManager,
  pluginManagers,
} from "./internal/plugin-manager.js";
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
export async function createCandidateProgram({
  bundledProvider,
  currentRepositoryService,
  loadedPlugins,
  pluginCommandOptions,
  pluginContextFactory,
  pluginManagerService,
  rootCommands,
  start,
  storeProjectService,
  ...options
} = {}) {
  const platform = await PluginPlatform.create({
    bundledProvider,
    contextFactory: pluginContextFactory,
    currentRepositoryService,
    loadedPlugins,
    managerService: pluginManagerService,
    pluginCommandOptions,
    rootCommands,
    start,
    storeProjectService,
  });
  return platform.createProgram(options);
}
