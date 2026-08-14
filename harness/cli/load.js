/** @fileoverview Пользовательский сценарий команды `openspec-orch load`. */

import { prepareLoad } from "../load/index.js";
import { stringify as stringifyYaml } from "yaml";
import { HELP, parseLoadArgs } from "./args.js";
import { reportProgress } from "./progress.js";

/**
 * Выполняет `openspec-orch load` и печатает машинный или компактный человекочитаемый результат.
 *
 * @param {string[]} args Аргументы без имени команды.
 * @returns {Promise<void>}
 */
export async function runLoad(args) {
  const options = parseLoadArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  reportProgress("Подготовка контекста реализации...");
  const result = await prepareLoad({
    storeId: options.storeId,
    repositoryId: options.repositoryId,
    changeId: options.change,
    baseline: options.baseline,
    workPackages: options.workPackages,
    noStrict: options.noStrict,
  });
  if (options.json) {
    console.log(JSON.stringify({
      step_status: result.stepStatus,
      execution_mode: result.executionMode,
      store_id: result.storeId,
      change_id: result.changeId,
      spec_baseline: result.specBaseline,
      repository_id: result.repositoryId,
      implementation_branch: result.implementationBranch,
      branch_status: result.branchStatus,
      code_base_revision: result.codeBaseRevision,
      schema: result.schema,
      implementation_mode: result.implementationMode,
      change_path: result.changePath,
      context_files: result.contextFiles,
      work_packages: result.workPackages,
      selected_tasks: result.selectedTasks,
      runtime_context: result.runtimePath,
      next_step: result.nextStep,
      next_action: result.nextAction,
    }, null, 2));
    return;
  }
  console.log(stringifyYaml({
    step_status: result.stepStatus,
    execution_mode: result.executionMode,
    store_id: result.storeId,
    change_id: result.changeId,
    spec_baseline: result.specBaseline,
    repository_id: result.repositoryId,
    implementation_branch: result.implementationBranch,
    branch_status: result.branchStatus,
    schema: result.schema,
    implementation_mode: result.implementationMode,
    change_path: result.changePath,
    context_files: result.contextFiles,
    work_packages: result.workPackages,
    selected_tasks: result.selectedTasks,
    next_step: result.nextStep,
    next_action: result.nextAction,
  }).trimEnd());
}
