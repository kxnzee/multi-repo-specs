/** @fileoverview Подготовка одного Code Repository к реализации на принятом Baseline. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateChangeName } from "../change/id.js";
import {
  assertRepositoryId,
  assertSupportedOpenSpecVersion,
  parseOrchestratorConfig,
  parseStoreMetadata,
  sameGitRemote,
} from "../config/index.js";
import { readPointer } from "../connect/pointer.js";
import { resolveCodeWorkspace } from "../connect/workspace.js";
import { runCommand } from "../shared/command.js";
import { isGitRevision } from "../shared/schema.js";
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
) {
  return [
    `Сначала прочитай файл инструкций агента ${JSON.stringify(agentInstructionsPath)}.`,
    `Затем прочитай и выполни инструкцию ${JSON.stringify(instructionPath)} с параметрами:`,
    `--store ${storeId}`,
    `--repo ${repositoryId}`,
    `--change ${changeId}`,
    `--baseline ${baseline}`,
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
async function readStoreFile(root, relativePath) {
  const target = path.join(root, relativePath);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath} должна быть обычным файлом`);
  return fs.readFile(target, "utf8");
}

/**
 * Проверяет identity Store и выбирает Code Repository по origin текущего checkout.
 *
 * @param {string} root
 * @param {string} storeId
 * @param {string} repositoryId
 * @param {string} codeOrigin
 * @param {typeof runCommand} commandRunner
 * @returns {Promise<{config: ReturnType<typeof parseOrchestratorConfig>, repository: import("../config/index.js").Repository}>}
 */
async function inspectStoreConfig(root, storeId, repositoryId, codeOrigin, commandRunner) {
  const metadata = parseStoreMetadata(await readStoreFile(root, ".openspec-store/store.yaml"));
  const config = parseOrchestratorConfig(await readStoreFile(root, "openspec-orch.yaml"));
  assertSupportedOpenSpecVersion(config.openSpecVersion);
  if (metadata.id !== storeId || config.storeRepository.id !== storeId) {
    throw new Error(`Store metadata и openspec-orch.yaml не подтверждают Store ${storeId}`);
  }
  assertRepositoryIdentity(root, config.storeRepository.url, storeId, commandRunner);
  if (metadata.remote !== undefined && !sameGitRemote(metadata.remote, config.storeRepository.url)) {
    throw new Error(`Store ${storeId}: metadata remote не совпадает с openspec-orch.yaml`);
  }
  const matches = config.codeRepositories.filter(({ id }) => id === repositoryId);
  if (matches.length !== 1) {
    throw new Error(`repository-id ${repositoryId} не найден однозначно в openspec-orch.yaml`);
  }
  if (!sameGitRemote(matches[0].url, codeOrigin)) {
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
  assertSupportedOpenSpecVersion(config.openSpecVersion);
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
 * @param {string} options.baseline
 * @param {string[]} options.workPackages
 * @param {typeof runCommand} [options.commandRunner]
 * @returns {Promise<import("../shared/types.js").LoadPreparation>}
 */
export async function prepareLoad({
  start = process.cwd(),
  storeId,
  repositoryId,
  changeId,
  baseline,
  workPackages,
  commandRunner = runCommand,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  assertRepositoryId(repositoryId);
  validateChangeName(changeId);
  if (!isGitRevision(baseline)) throw new Error("spec_baseline должна быть полной lowercase Git SHA");
  if (!Array.isArray(workPackages) || workPackages.length === 0) {
    throw new Error("Требуется хотя бы один Work Package ID");
  }
  if (
    new Set(workPackages).size !== workPackages.length ||
    workPackages.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error("Work Package ID должны быть непустыми уникальными task.id из OpenSpec");
  }

  const codeRoot = await fs.realpath(path.resolve(start));
  const actualCodeRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: codeRoot }),
  );
  if (actualCodeRoot !== codeRoot) throw new Error("openspec-orch load нужно запускать из корня Code Repository");
  const codeOrigin = commandRunner("git", ["remote", "get-url", "origin"], { cwd: codeRoot });
  assertClean(codeRoot, commandRunner);
  await assertNoGitOperation(codeRoot, commandRunner);
  const pointerStoreId = await readPointer(codeRoot);
  if (pointerStoreId !== storeId) {
    throw new Error(`Code Repository указывает на Store ${pointerStoreId}, а subtask передала ${storeId}`);
  }
  const declaredStoreRoot = resolveHealthyStore(storeId, codeRoot, commandRunner);
  const storeRoot = await fs.realpath(declaredStoreRoot);
  if (storeRoot !== declaredStoreRoot) throw new Error("Зарегистрированный Store root не должен быть symlink");

  const currentMetadata = parseStoreMetadata(await readStoreFile(storeRoot, ".openspec-store/store.yaml"));
  if (currentMetadata.id !== storeId || !currentMetadata.remote) {
    throw new Error(`Store metadata не подтверждает Store ${storeId} и его remote`);
  }
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
  const workspace = await resolveCodeWorkspace(codeRoot);
  const runtimeRoot = await ensureRuntimeDirectory(workspace, [storeId, changeId, repositoryId]);
  const worktreeRoot = path.join(runtimeRoot, "store");
  await removeRuntimeContext(runtimeRoot);
  await ensureStoreWorktree({ storeRoot, worktreeRoot, baseline, commandRunner });
  const worktreeRevision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot });
  if (worktreeRevision !== baseline) throw new Error("Runtime Store worktree находится не на spec_baseline");

  const baselineStore = await inspectStoreConfig(
    worktreeRoot,
    storeId,
    repositoryId,
    codeOrigin,
    commandRunner,
  );
  const applyInstructionRelativePath = path.join(
    baselineStore.config.agent.commandsDirectory,
    "sdd-apply.md",
  );
  const agentInstructionsRelativePath = baselineStore.config.agent.instructionsFile;
  await Promise.all([
    readStoreFile(worktreeRoot, agentInstructionsRelativePath),
    readStoreFile(worktreeRoot, applyInstructionRelativePath),
  ]);
  const agentInstructionsPath = path.join(worktreeRoot, agentInstructionsRelativePath);
  const applyInstructionPath = path.join(worktreeRoot, applyInstructionRelativePath);
  const selectedTasks = validateImplementationInput({
    worktreeRoot,
    changeId,
    workPackages,
    commandRunner,
  });
  assertClean(worktreeRoot, commandRunner);

  const branch = await prepareImplementationBranch({
    codeRoot,
    repository: baselineStore.repository,
    changeId,
    commandRunner,
  });
  const context = {
    version: 1,
    step_status: "implementation_ready",
    store_id: storeId,
    change_id: changeId,
    spec_baseline: baseline,
    spec_root: worktreeRoot,
    repository_id: repositoryId,
    code_root: codeRoot,
    implementation_branch: branch.branch,
    code_base_revision: branch.codeBaseRevision,
    work_packages: [...workPackages],
    allowed_edit_roots: [codeRoot],
    immutable_roots: [worktreeRoot],
  };
  const runtimePath = await writeRuntimeContext(runtimeRoot, context);
  return {
    stepStatus: "implementation_ready",
    storeId,
    changeId,
    specBaseline: baseline,
    repositoryId,
    implementationBranch: branch.branch,
    branchStatus: branch.branchStatus,
    codeBaseRevision: branch.codeBaseRevision,
    workPackages: [...workPackages],
    selectedTasks,
    nextStep: "06",
    nextAction: buildApplyPrompt(
      agentInstructionsPath,
      applyInstructionPath,
      storeId,
      repositoryId,
      changeId,
      baseline,
      workPackages,
    ),
    runtimePath,
  };
}
