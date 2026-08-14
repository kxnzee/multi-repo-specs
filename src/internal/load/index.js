/** @fileoverview Подготовка одного Code Repository к реализации на принятом Baseline. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateChangeName } from "../change/id.js";
import {
  assertRepositoryId,
  parseOrchestratorConfig,
  parseStoreMetadata,
  requireAgentHandoff,
  resolveExecutionMode,
  sameGitRemote,
} from "../config/index.js";
import { readPointer } from "../connect/pointer.js";
import { runCommand } from "../shared/command.js";
import { readRelativeRegularFile } from "../shared/files.js";
import { isGitRevision } from "../shared/schema.js";
import { resolveCodeWorkspace } from "../shared/workspace.js";
import {
  assertClean,
  assertNoGitOperation,
  assertRepositoryIdentity,
  ensureStoreWorktree,
  fetchStoreObjects,
  prepareImplementationBranch,
} from "./git.js";
import { resolveHealthyStore, validateImplementationInput } from "./openspec.js";
import {
  ensureRuntimeDirectory,
  removeRuntimeContext,
  writeRuntimeContext,
} from "./runtime.js";

/**
 * Формирует первое сообщение Apply с точными provider- и runtime-инструкциями.
 *
 * @param {string} agentInstructionsPath
 * @param {string} instructionPath
 * @param {string} storeId
 * @param {string} repositoryId
 * @param {string} changeId
 * @param {string} baseline
 * @param {string[]} workPackages
 * @param {"strict" | "relaxed"} executionMode
 * @param {"package" | "whole-change"} implementationMode
 * @returns {string}
 */
function buildApplyPrompt(
  agentInstructionsPath,
  instructionPath,
  storeId,
  repositoryId,
  changeId,
  baseline,
  workPackages,
  executionMode,
  implementationMode,
) {
  return [
    `Сначала прочитай файл инструкций агента ${JSON.stringify(agentInstructionsPath)}.`,
    `Затем прочитай и выполни инструкцию ${JSON.stringify(instructionPath)} с параметрами:`,
    `--store ${storeId}`,
    `--repo ${repositoryId}`,
    `--change ${changeId}`,
    `--baseline ${baseline}`,
    `--execution-mode ${executionMode}`,
    `--implementation-mode ${implementationMode}`,
    ...workPackages.map((id) => `--work-package ${JSON.stringify(id)}`),
  ].join(" ");
}

/**
 * Читает принадлежащий Store обычный файл, не следуя symlink последнего сегмента.
 *
 * @param {string} root
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
const readStoreFile = readRelativeRegularFile;

/**
 * Проверяет identity Store и выбирает Code Repository по origin текущего checkout.
 *
 * @param {string} root
 * @param {string} storeId
 * @param {string} repositoryId
 * @param {string | undefined} codeOrigin
 * @param {typeof runCommand} commandRunner
 * @param {boolean} strict
 * @returns {Promise<{config: ReturnType<typeof parseOrchestratorConfig>, repository: import("../config/index.js").Repository}>}
 */
async function inspectStoreConfig(root, storeId, repositoryId, codeOrigin, commandRunner, strict) {
  const metadata = parseStoreMetadata(await readStoreFile(root, ".openspec-store/store.yaml"));
  const config = parseOrchestratorConfig(await readStoreFile(root, "openspec-orch.yaml"));
  if (metadata.id !== storeId || config.storeRepository.id !== storeId) {
    throw new Error(`Store metadata и openspec-orch.yaml не подтверждают Store ${storeId}`);
  }
  if (strict) assertRepositoryIdentity(root, config.storeRepository.url, storeId, commandRunner);
  if (metadata.remote !== undefined && !sameGitRemote(metadata.remote, config.storeRepository.url)) {
    throw new Error(`Store ${storeId}: metadata remote не совпадает с openspec-orch.yaml`);
  }
  const matches = config.codeRepositories.filter(({ id }) => id === repositoryId);
  if (matches.length !== 1) {
    throw new Error(`repository-id ${repositoryId} не найден однозначно в openspec-orch.yaml`);
  }
  if (strict && !sameGitRemote(matches[0].url, codeOrigin ?? "")) {
    throw new Error(`repository-id ${repositoryId}: origin не совпадает с openspec-orch.yaml`);
  }
  return { config, repository: matches[0] };
}

/**
 * Читает конфигурацию непосредственно из принятой commit, не доверяя рабочим файлам Store.
 *
 * @param {string} storeRoot
 * @param {string} storeId
 * @param {string} baseline
 * @param {string} repositoryId
 * @param {string} codeOrigin
 * @param {typeof runCommand} commandRunner
 * @returns {{config: ReturnType<typeof parseOrchestratorConfig>, repository: import("../config/index.js").Repository}}
 */
function inspectBaselineConfig(
  storeRoot,
  storeId,
  baseline,
  repositoryId,
  codeOrigin,
  commandRunner,
) {
  const config = parseOrchestratorConfig(
    commandRunner("git", ["show", `${baseline}:openspec-orch.yaml`], { cwd: storeRoot }),
  );
  if (config.storeRepository.id !== storeId) {
    throw new Error(`openspec-orch.yaml на spec_baseline не подтверждает Store ${storeId}`);
  }
  const storeOrigin = commandRunner("git", ["remote", "get-url", "origin"], { cwd: storeRoot });
  if (!sameGitRemote(config.storeRepository.url, storeOrigin)) {
    throw new Error(`Store ${storeId}: origin не совпадает с openspec-orch.yaml на spec_baseline`);
  }
  const matches = config.codeRepositories.filter(({ id }) => id === repositoryId);
  if (matches.length !== 1) {
    throw new Error(`repository-id ${repositoryId} не найден однозначно в openspec-orch.yaml на spec_baseline`);
  }
  if (!sameGitRemote(matches[0].url, codeOrigin)) {
    throw new Error(`repository-id ${repositoryId}: origin не совпадает с openspec-orch.yaml на spec_baseline`);
  }
  return { config, repository: matches[0] };
}

/**
 * Подготавливает Code Repository и точный Store worktree для шага 06.
 *
 * @param {object} options
 * @param {string} [options.start]
 * @param {string} options.storeId
 * @param {string} options.repositoryId
 * @param {string} options.changeId
 * @param {string} [options.baseline]
 * @param {string[]} [options.workPackages]
 * @param {boolean} [options.noStrict]
 * @param {typeof runCommand} [options.commandRunner]
 * @returns {Promise<import("../shared/types.js").LoadPreparation>}
 */
export async function prepareLoad({
  start = process.cwd(),
  storeId,
  repositoryId,
  changeId,
  baseline,
  workPackages = [],
  noStrict = false,
  commandRunner = runCommand,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  assertRepositoryId(repositoryId);
  validateChangeName(changeId);
  if (!Array.isArray(workPackages) ||
    new Set(workPackages).size !== workPackages.length ||
    workPackages.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error("Work Package ID должны быть непустыми уникальными task.id из OpenSpec");
  }

  const codeRoot = await fs.realpath(path.resolve(start));
  const pointerStoreId = await readPointer(codeRoot);
  if (pointerStoreId !== storeId) {
    throw new Error(`Code Repository указывает на Store ${pointerStoreId}, а subtask передала ${storeId}`);
  }
  const declaredStoreRoot = resolveHealthyStore(storeId, codeRoot, commandRunner);
  const storeRoot = await fs.realpath(declaredStoreRoot);
  if (storeRoot !== declaredStoreRoot) throw new Error("Зарегистрированный Store root не должен быть symlink");

  const currentMetadata = parseStoreMetadata(await readStoreFile(storeRoot, ".openspec-store/store.yaml"));
  const currentConfigSource = await readStoreFile(storeRoot, "openspec-orch.yaml");
  let currentConfig;
  try {
    currentConfig = parseOrchestratorConfig(currentConfigSource);
  } catch (error) {
    if (noStrict || !isGitRevision(baseline)) throw error;
    currentConfig = parseOrchestratorConfig(
      commandRunner("git", ["show", `${baseline}:openspec-orch.yaml`], { cwd: storeRoot }),
    );
  }
  const executionMode = resolveExecutionMode(currentConfig.strict, noStrict);
  const strict = executionMode === "strict";
  if (
    currentMetadata.id !== storeId || currentConfig.storeRepository.id !== storeId ||
    !currentMetadata.remote || !sameGitRemote(currentMetadata.remote, currentConfig.storeRepository.url)
  ) {
    throw new Error(`Store metadata не подтверждает Store ${storeId} и его remote`);
  }
  if (strict && !isGitRevision(baseline)) {
    throw new Error("strict mode требует --baseline с полной lowercase Git SHA");
  }
  if (!strict && baseline !== undefined) {
    throw new Error("relaxed mode не использует --baseline; удалите параметр");
  }
  if (path.basename(codeRoot) !== repositoryId) {
    throw new Error(`repository-id ${repositoryId} не совпадает с локальным каталогом Code Repository`);
  }
  const workspace = await resolveCodeWorkspace(codeRoot);
  const runtimeRoot = await ensureRuntimeDirectory(workspace, [storeId, changeId, repositoryId]);
  await removeRuntimeContext(runtimeRoot);
  let specRoot;
  let effectiveBaseline;
  let selectedStore;
  let branch;
  if (strict) {
    const actualCodeRoot = path.resolve(
      commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: codeRoot }),
    );
    if (actualCodeRoot !== codeRoot) {
      throw new Error("openspec-orch load нужно запускать из корня Code Repository");
    }
    const codeOrigin = commandRunner("git", ["remote", "get-url", "origin"], { cwd: codeRoot });
    assertClean(codeRoot, commandRunner);
    await assertNoGitOperation(codeRoot, commandRunner);
    assertRepositoryIdentity(storeRoot, currentMetadata.remote, storeId, commandRunner);
    fetchStoreObjects(storeRoot, baseline, commandRunner);
    const acceptedStore = inspectBaselineConfig(
      storeRoot,
      storeId,
      baseline,
      repositoryId,
      codeOrigin,
      commandRunner,
    );
    if (!sameGitRemote(currentMetadata.remote, acceptedStore.config.storeRepository.url)) {
      throw new Error(`Store ${storeId}: metadata remote не совпадает с openspec-orch.yaml на spec_baseline`);
    }
    specRoot = path.join(runtimeRoot, "store");
    await ensureStoreWorktree({ storeRoot, worktreeRoot: specRoot, baseline, commandRunner });
    const worktreeRevision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: specRoot });
    if (worktreeRevision !== baseline) {
      throw new Error("Runtime Store worktree находится не на spec_baseline");
    }
    selectedStore = await inspectStoreConfig(
      specRoot,
      storeId,
      repositoryId,
      codeOrigin,
      commandRunner,
      true,
    );
    effectiveBaseline = baseline;
  } else {
    specRoot = storeRoot;
    selectedStore = await inspectStoreConfig(
      specRoot,
      storeId,
      repositoryId,
      undefined,
      commandRunner,
      false,
    );
    effectiveBaseline = "unpinned";
    branch = { branch: null, branchStatus: "unmanaged", codeBaseRevision: "unpinned" };
  }
  const applyInstructionRelativePath = requireAgentHandoff(
    selectedStore.config.agent,
    "apply",
    "openspec-orch load",
  );
  const agentInstructionsRelativePath = selectedStore.config.agent.instructionsFile;
  await Promise.all([
    readStoreFile(specRoot, agentInstructionsRelativePath),
    readStoreFile(specRoot, applyInstructionRelativePath),
  ]);
  const agentInstructionsPath = path.join(specRoot, agentInstructionsRelativePath);
  const applyInstructionPath = path.join(specRoot, applyInstructionRelativePath);
  const implementation = await validateImplementationInput({
    worktreeRoot: specRoot,
    changeId,
    workPackages,
    commandRunner,
    strict,
  });
  if (strict) assertClean(specRoot, commandRunner);
  if (strict) {
    branch = await prepareImplementationBranch({
      codeRoot,
      repository: selectedStore.repository,
      changeId,
      commandRunner,
    });
  }
  const context = {
    version: 2,
    step_status: "implementation_ready",
    store_id: storeId,
    change_id: changeId,
    execution_mode: executionMode,
    spec_baseline: effectiveBaseline,
    spec_root: specRoot,
    repository_id: repositoryId,
    code_root: codeRoot,
    implementation_branch: branch.branch,
    code_base_revision: branch.codeBaseRevision,
    schema: implementation.schema,
    implementation_mode: implementation.implementationMode,
    change_root: implementation.changeRoot,
    context_files: implementation.contextFiles,
    work_packages: [...workPackages],
    allowed_edit_roots: [codeRoot],
    immutable_roots: strict ? [specRoot] : [],
  };
  const runtimePath = await writeRuntimeContext(runtimeRoot, context);
  return {
    stepStatus: "implementation_ready",
    executionMode,
    storeId,
    changeId,
    specBaseline: effectiveBaseline,
    repositoryId,
    implementationBranch: branch.branch,
    branchStatus: branch.branchStatus,
    codeBaseRevision: branch.codeBaseRevision,
    schema: implementation.schema,
    implementationMode: implementation.implementationMode,
    changePath: implementation.changeRoot,
    contextFiles: implementation.contextFiles,
    workPackages: [...workPackages],
    selectedTasks: implementation.selectedTasks,
    nextStep: "06",
    nextAction: buildApplyPrompt(
      agentInstructionsPath,
      applyInstructionPath,
      storeId,
      repositoryId,
      changeId,
      effectiveBaseline,
      workPackages,
      executionMode,
      implementation.implementationMode,
    ),
    runtimePath,
  };
}
