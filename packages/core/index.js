/** @fileoverview Публичная граница нового Orchestrator Core. */

import { Command } from "commander";

/** Создаёт минимальный candidate CLI до переноса Core operations. */
export function createCandidateProgram() {
  return new Command()
    .name("openspec-orch")
    .description("OpenSpec Orchestrator candidate runtime")
    .showHelpAfterError();
}
