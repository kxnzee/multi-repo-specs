/** @fileoverview Публичная граница нового Orchestrator Core. */

import { Command } from "commander";

export { CoreConfiguration, configuration } from "./internal/configuration.js";
export { Project, createProject } from "./internal/project.js";
export { Repository, createRepository } from "./internal/repository.js";
export { Store, createStore } from "./internal/store.js";

/** Создаёт минимальный candidate CLI до переноса Core operations. */
export function createCandidateProgram() {
  return new Command()
    .name("openspec-orch")
    .description("OpenSpec Orchestrator candidate runtime")
    .showHelpAfterError();
}
