/** @fileoverview Пользовательский сценарий команды `openspec-orch load`. */

import { prepareLoad } from "../../internal/load/index.js";
import { stringify as stringifyYaml } from "yaml";
import { withProgress } from "../progress.js";

/**
 * Выполняет `openspec-orch load` и печатает машинный или компактный человекочитаемый результат.
 *
 * @param {{storeId: string, repositoryId: string, change: string, baseline?: string, workPackages: string[], noStrict: boolean, json: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runLoad(options) {
  const result = await withProgress(
    {
      start: "Подготовка контекста реализации",
      success: "Контекст реализации подготовлен",
      failure: "Контекст реализации не подготовлен",
    },
    () => prepareLoad({
      storeId: options.storeId,
      repositoryId: options.repositoryId,
      changeId: options.change,
      baseline: options.baseline,
      workPackages: options.workPackages,
      noStrict: options.noStrict,
    }),
  );
  const output = {
    step_status: result.stepStatus,
    execution_mode: result.executionMode,
    store_id: result.storeId,
    change_id: result.changeId,
    spec_baseline: result.specBaseline,
    repository_id: result.repositoryId,
    implementation_branch: result.implementationBranch,
    branch_status: result.branchStatus,
    ...(options.json ? { code_base_revision: result.codeBaseRevision } : {}),
    schema: result.schema,
    implementation_mode: result.implementationMode,
    change_path: result.changePath,
    context_files: result.contextFiles,
    work_packages: result.workPackages,
    selected_tasks: result.selectedTasks,
    ...(options.json ? { runtime_context: result.runtimePath } : {}),
    next_step: result.nextStep,
    next_action: result.nextAction,
  };
  console.log(options.json
    ? JSON.stringify(output, null, 2)
    : stringifyYaml(output).trimEnd());
}
