/** @fileoverview Публичная граница нового Orchestrator Core. */

import { Command } from "commander";

export { AtomicWriter, atomicWriter } from "./internal/atomic-writer.js";
export { RepositoryCheckout, createRepositoryCheckout } from "./internal/checkout.js";
export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { FileService, RepositoryFiles, files } from "./internal/files.js";
export { GitService, RepositoryGit, WorkspaceGit, git } from "./internal/git.js";
export { OpenSpecService, RepositoryOpenSpec, openspec } from "./internal/openspec.js";
export { FailClosedLock, locks } from "./internal/lock.js";
export { PluginStorage, PluginStorageService, pluginStorage } from "./internal/plugin-storage.js";
export { ProcessService, ScopedProcess, processes } from "./internal/process.js";
export { Project, createProject } from "./internal/project.js";
export { Repository, createRepository } from "./internal/repository.js";
export { Store, createStore } from "./internal/store.js";
export { Workspace, WorkspaceResolver, workspace } from "./internal/workspace.js";

/** Создаёт минимальный candidate CLI до переноса Core operations. */
export function createCandidateProgram() {
  return new Command()
    .name("openspec-orch")
    .description("OpenSpec Orchestrator candidate runtime")
    .showHelpAfterError();
}
