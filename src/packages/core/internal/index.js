/**
 * @fileoverview Карта внутреннего Core.
 *
 * Это единственная точка, из которой публичный `@openspec-orch/core` получает
 * поддерживаемые реализации. Папки ниже отражают ответственность, а не порядок
 * загрузки: доменные сервисы не должны импортироваться через этот barrel внутри Core.
 */

// Agent adapters and bundled Agent definitions.
export { AddonAuthoringService } from "./authoring/authoring.js";
export { createAuthoringCommand } from "./authoring/cli.js";
export { validateAddon } from "./authoring/validation.js";
export { AgentDefinition } from "./agents/agent-definition.js";
export { AgentCatalog, AgentCatalogEntry, BundledAgentPackage, BundledAgentProvider, bundledAgents } from "./agents/bundled-agent.js";
export { AgentExtensionAdapter, agentExtensions } from "./agents/agent-extension-adapter.js";
export { AgentGatewayService } from "./agents/agent-gateway.js";

// Presentation and configuration.
export { CandidateCli } from "./cli/cli.js";
export { CoreConfiguration, configuration } from "./configuration/configuration.js";
export { DiagnosticReport, DiagnosticResult, DoctorService, doctor } from "./diagnostics/doctor.js";

// Standalone Extensions.
export { BundledExtensionPackage, BundledExtensionProvider, NpmExtensionPackage, bundledExtensions } from "./extensions/bundled-extension.js";
export { ExtensionCatalog, ExtensionCatalogEntry, extensionCatalog } from "./extensions/extension-catalog.js";
export { ExtensionCommands } from "./extensions/extension-cli.js";
export { ExtensionDeclaration } from "./extensions/extension-declaration.js";
export { ExtensionLifecycle } from "./extensions/extension-lifecycle.js";
export { ExtensionApplicationService } from "./extensions/extension-application.js";
export { ExtensionManagerService, StoreExtensionManager } from "./extensions/extension-manager.js";

// Filesystem, Git, process and npm adapters.
export { AtomicWriter, atomicWriter } from "./infrastructure/atomic-writer.js";
export { FileService, RepositoryFiles, files } from "./infrastructure/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./infrastructure/git.js";
export { FailClosedLock, locks } from "./infrastructure/lock.js";
export { NpmPackageInstaller, npmPackageInstaller } from "./infrastructure/npm-package-installer.js";
export { ProcessService, ScopedProcess, processes, redactSensitive } from "./infrastructure/process.js";

// OpenSpec and Store-local package runtime.
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./openspec/openspec.js";
export { PackageCommands } from "./packages/package-cli.js";
export { PackageSupplyService, StorePackageSupply, packageSupplies } from "./packages/package-supply.js";

// Generic Plugin runtime; concrete Plugin behavior remains outside Core.
export { BundledPluginPackage, BundledPluginProvider, bundledPlugins } from "./plugin-runtime/bundled-plugin.js";
export { PluginBindingChange, PluginApplicationResult, PluginApplicationService, PluginRemovalResult, pluginApplications } from "./plugin-runtime/plugin-application.js";
export { PluginCatalog, PluginCatalogEntry, pluginCatalog } from "./plugin-runtime/plugin-catalog.js";
export { PluginLifecycleCommands } from "./plugin-runtime/plugin-cli.js";
export { PluginContext, PluginContextFactory, pluginContexts } from "./plugin-runtime/plugin-context.js";
export { PluginDeclaration } from "./plugin-runtime/plugin-declaration.js";
export { PluginHost, PluginRegistry } from "./plugin-runtime/plugin-host.js";
export { PluginInstallation } from "./plugin-runtime/plugin-installation.js";
export { PluginConnectionResult, PluginDisconnectionResult, PluginLifecycleService, PluginStatusResult } from "./plugin-runtime/plugin-lifecycle.js";
export { LoadedPlugin, PluginLoader, pluginLoader } from "./plugin-runtime/plugin-loader.js";
export { PluginManagerService, StorePluginManager, pluginManagers } from "./plugin-runtime/plugin-manager.js";
export { PluginPlatform } from "./plugin-runtime/plugin-platform.js";
export { PluginScaffoldService, pluginScaffolds } from "./plugin-runtime/plugin-scaffold.js";
export { PluginSource } from "./plugin-runtime/plugin-source.js";
export { PluginStorage, PluginStorageService, pluginStorage } from "./plugin-runtime/plugin-storage.js";

// Project model and local runtime state.
export { RepositoryCheckout, createRepositoryCheckout } from "./project/checkout.js";
export { CurrentRepositoryService, currentRepositories } from "./project/current-repository.js";
export { Project, createProject } from "./project/project.js";
export { Repository, createRepository } from "./project/repository.js";
export { RepositoryRunner, RepositorySelector, repositoryRunner, repositorySelector } from "./project/repository-operations.js";
export { RepositoryStatus, RepositoryStatusService, repositoryStatuses } from "./project/repository-status.js";
export { Store, createStore } from "./project/store.js";
export { StoreProject, StoreProjectService, storeProjects } from "./project/store-project.js";
export { StoreTarget } from "./project/store-target.js";
export { Workspace, WorkspaceResolver, workspace } from "./project/workspace.js";
export { CoreState, CoreStateService, CoreStateStore, coreState } from "./runtime/core-state.js";
export { OpenSpecPointerService, pointers } from "./runtime/pointer.js";

// Project initialization and connection workflow.
export { ConnectionResult, ConnectionService, RepositoryConnection, connection } from "./setup/connection.js";
export { InitializationService, initialization } from "./setup/initialization.js";
export { InitSelectionService, initSelections } from "./setup/init-selection.js";
export { ProjectSetupService } from "./setup/project-setup.js";

// Copy-only Project Templates.
export { BundledTemplatePackage, BundledTemplateProvider, TemplateCatalog, TemplateCatalogEntry, bundledTemplates, isBundledTemplateProvider } from "./templates/bundled-template.js";
export { ProjectTemplateService, TemplatePlan, projectTemplates } from "./templates/template.js";
