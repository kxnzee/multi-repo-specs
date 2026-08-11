/** @fileoverview Пользовательский сценарий команды `sdd load`. */

import { prepareLoad } from "../load/index.js";
import { HELP, parseLoadArgs } from "./args.js";
import { reportProgress } from "./progress.js";

/**
 * Выполняет `sdd load` и печатает машинный или компактный человекочитаемый результат.
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
  });
  if (options.json) {
    console.log(JSON.stringify({
      step_status: result.stepStatus,
      store_id: result.storeId,
      change_id: result.changeId,
      spec_baseline: result.specBaseline,
      repository_id: result.repositoryId,
      implementation_branch: result.implementationBranch,
      branch_status: result.branchStatus,
      code_base_revision: result.codeBaseRevision,
      work_packages: result.workPackages,
      selected_tasks: result.selectedTasks,
      runtime_context: result.runtimePath,
      next_step: result.nextStep,
      next_action: result.nextAction,
    }, null, 2));
    return;
  }
  const selectedTaskLines = result.selectedTasks.flatMap((task) => [
    `  - id: ${JSON.stringify(task.id)}`,
    `    description: ${JSON.stringify(task.description)}`,
  ]);
  console.log([
    `step_status: ${result.stepStatus}`,
    `store_id: ${result.storeId}`,
    `change_id: ${result.changeId}`,
    `spec_baseline: ${result.specBaseline}`,
    `repository_id: ${result.repositoryId}`,
    `implementation_branch: ${result.implementationBranch}`,
    `branch_status: ${result.branchStatus}`,
    `work_packages: ${result.workPackages.join(", ")}`,
    "selected_tasks:",
    ...selectedTaskLines,
    `next_step: ${result.nextStep}`,
    `next_action: ${result.nextAction}`,
  ].join("\n"));
}
