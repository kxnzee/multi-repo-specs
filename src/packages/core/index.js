/** @fileoverview Публичная граница нового Orchestrator Core. */

export { AgentDefinition } from "./internal/agents/agent-definition.js";
export {
  AgentCatalog,
  AgentCatalogEntry,
  BundledAgentPackage,
  BundledAgentProvider,
  bundledAgents,
} from "./internal/agents/bundled-agent.js";
export {
  AgentExtensionAdapter,
  agentExtensions,
} from "./internal/agents/agent-extension-adapter.js";
export { AgentGatewayService } from "./internal/agents/agent-gateway.js";
export { AtomicWriter, atomicWriter } from "./internal/atomic-writer.js";
export {
  BundledPluginPackage,
  BundledPluginProvider,
  bundledPlugins,
} from "./internal/plugin-runtime/bundled-plugin.js";
export {
  BundledTemplatePackage,
  BundledTemplateProvider,
  TemplateCatalog,
  TemplateCatalogEntry,
  bundledTemplates,
  isBundledTemplateProvider,
} from "./internal/templates/bundled-template.js";
export {
  BundledExtensionPackage,
  BundledExtensionProvider,
  NpmExtensionPackage,
  bundledExtensions,
} from "./internal/extensions/bundled-extension.js";
export { CandidateCli } from "./internal/cli.js";
export { ConnectionResult, ConnectionService, RepositoryConnection, connection } from "./internal/connection.js";
export { RepositoryCheckout, createRepositoryCheckout } from "./internal/project/checkout.js";
export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { CoreState, CoreStateService, CoreStateStore, coreState } from "./internal/core-state.js";
export { CurrentRepositoryService, currentRepositories } from "./internal/project/current-repository.js";
export {
  DiagnosticReport,
  DiagnosticResult,
  DoctorService,
  doctor,
} from "./internal/doctor.js";
export { FileService, RepositoryFiles, files } from "./internal/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./internal/git.js";
export { InitializationService, initialization } from "./internal/initialization.js";
export { InitSelectionService, initSelections } from "./internal/init-selection.js";
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./internal/openspec/openspec.js";
export { OpenSpecPointerService, pointers } from "./internal/pointer.js";
export { FailClosedLock, locks } from "./internal/lock.js";
export { PluginContext, PluginContextFactory, pluginContexts } from "./internal/plugin-runtime/plugin-context.js";
export { PluginDeclaration } from "./internal/plugin-runtime/plugin-declaration.js";
export {
  PluginBindingChange,
  PluginApplicationResult,
  PluginApplicationService,
  PluginRemovalResult,
  pluginApplications,
} from "./internal/plugin-runtime/plugin-application.js";
export { PluginLifecycleCommands } from "./internal/plugin-runtime/plugin-cli.js";
export { PluginCatalog, PluginCatalogEntry, pluginCatalog } from "./internal/plugin-runtime/plugin-catalog.js";
export {
  ExtensionCatalog,
  ExtensionCatalogEntry,
  extensionCatalog,
} from "./internal/extensions/extension-catalog.js";
export { ExtensionDeclaration } from "./internal/extensions/extension-declaration.js";
export { ExtensionLifecycle } from "./internal/extensions/extension-lifecycle.js";
export { ExtensionApplicationService } from "./internal/extensions/extension-application.js";
export { ExtensionManagerService, StoreExtensionManager } from "./internal/extensions/extension-manager.js";
export { PluginHost, PluginRegistry } from "./internal/plugin-runtime/plugin-host.js";
export {
  PluginConnectionResult,
  PluginDisconnectionResult,
  PluginLifecycleService,
  PluginStatusResult,
} from "./internal/plugin-runtime/plugin-lifecycle.js";
export { LoadedPlugin, PluginLoader, pluginLoader } from "./internal/plugin-runtime/plugin-loader.js";
export { PluginInstallation } from "./internal/plugin-runtime/plugin-installation.js";
export {
  PluginManagerService,
  StorePluginManager,
  pluginManagers,
} from "./internal/plugin-runtime/plugin-manager.js";
export { NpmPackageInstaller, npmPackageInstaller } from "./internal/npm-package-installer.js";
export { ExtensionCommands } from "./internal/extensions/extension-cli.js";
export { PackageSupplyService, StorePackageSupply, packageSupplies } from "./internal/packages/package-supply.js";
export { PackageCommands } from "./internal/packages/package-cli.js";
export { PluginPlatform } from "./internal/plugin-runtime/plugin-platform.js";
export { PluginSource } from "./internal/plugin-runtime/plugin-source.js";
export { PluginScaffoldService, pluginScaffolds } from "./internal/plugin-runtime/plugin-scaffold.js";
export { PluginStorage, PluginStorageService, pluginStorage } from "./internal/plugin-runtime/plugin-storage.js";
export { ProcessService, ScopedProcess, processes, redactSensitive } from "./internal/process.js";
export { ProjectSetupService } from "./internal/project-setup.js";
export { Project, createProject } from "./internal/project/project.js";
export { Repository, createRepository } from "./internal/project/repository.js";
export { RepositoryRunner, RepositorySelector, repositoryRunner, repositorySelector } from "./internal/project/repository-operations.js";
export { RepositoryStatus, RepositoryStatusService, repositoryStatuses } from "./internal/project/repository-status.js";
export { Store, createStore } from "./internal/project/store.js";
export { StoreProject, StoreProjectService, storeProjects } from "./internal/project/store-project.js";
export { StoreTarget } from "./internal/project/store-target.js";
export {
  ProjectTemplateService,
  TemplatePlan,
  projectTemplates,
} from "./internal/templates/template.js";
export { Workspace, WorkspaceResolver, workspace } from "./internal/project/workspace.js";

import { PluginPlatform } from "./internal/plugin-runtime/plugin-platform.js";

/** Создаёт candidate CLI с уже перенесёнными Core operations. */
export async function createCandidateProgram({
  bundledAgentProvider,
  bundledExtensionProvider,
  bundledTemplateProvider,
  bundledProvider,
  loadedPlugins,
  pluginCommandOptions,
  pluginContextFactory,
  pluginManagerService,
  start,
  storeProjectService,
  ...options
} = {}) {
  const platform = await PluginPlatform.create({
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledTemplateProvider,
    bundledProvider,
    contextFactory: pluginContextFactory,
    loadedPlugins,
    managerService: pluginManagerService,
    pluginCommandOptions,
    start,
    storeProjectService,
  });
  return platform.createProgram(options);
}
