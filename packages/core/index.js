/** @fileoverview Публичная граница нового Orchestrator Core. */

export { AtomicWriter, atomicWriter } from "./internal/atomic-writer.js";
export { CandidateCli } from "./internal/cli.js";
export { RepositoryCheckout, createRepositoryCheckout } from "./internal/checkout.js";
export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { FileService, RepositoryFiles, files } from "./internal/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./internal/git.js";
export { InitializationService, initialization } from "./internal/initialization.js";
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./internal/openspec.js";
export { FailClosedLock, locks } from "./internal/lock.js";
export { PluginStorage, PluginStorageService, pluginStorage } from "./internal/plugin-storage.js";
export { ProcessService, ScopedProcess, processes } from "./internal/process.js";
export { Project, createProject } from "./internal/project.js";
export { Repository, createRepository } from "./internal/repository.js";
export { Store, createStore } from "./internal/store.js";
export { StoreTarget } from "./internal/store-target.js";
export {
  ProjectTemplateService,
  TemplateAgent,
  TemplatePlan,
  projectTemplates,
} from "./internal/template.js";
export { Workspace, WorkspaceResolver, workspace } from "./internal/workspace.js";

import { CandidateCli } from "./internal/cli.js";

/** Создаёт candidate CLI с уже перенесёнными Core operations. */
export function createCandidateProgram(options) {
  return new CandidateCli(options).createProgram();
}
