/** @fileoverview Детерминированное создание или продолжение OpenSpec Change шага 02. */

import process from "node:process";

import { resolveExecutionMode } from "../config/index.js";
import { findDuplicates } from "../explore/validation/ticket.js";
import { runCommand } from "../shared/command.js";
import { runOpenSpecJson } from "../shared/openspec.js";
import {
  currentBranch,
  inspectContinuationChangeGit,
  inspectInitialChangeGit,
} from "./git.js";
import { buildChangeId } from "./id.js";
import {
  assertCreatedChange,
  readChangeStatus,
  resolveChangeStore,
} from "./store.js";

export { buildChangeId, validateChangeName } from "./id.js";

/**
 * Подготавливает стандартный Change, не создавая Proposal от имени CLI.
 *
 * @param {object} [options] Параметры команды.
 * @param {string} [options.start] Текущий каталог внутри центрального Store.
 * @param {string} options.ticket Внешний ticket key.
 * @param {string} options.name Короткое lowercase kebab-case имя.
 * @param {string} [options.storeId] Явно переданный Store ID, который должен совпасть с текущим checkout.
 * @param {(changes: string[]) => Promise<boolean> | boolean} [options.confirmArchivedChange]
 * Подтверждение повторной работы по архивному ticket.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд; переопределяется в тестах.
 * @param {boolean} [options.noStrict] Отключить Git-гарантии для текущего вызова.
 * @returns {Promise<import("../shared/types.js").ChangePreparation>} Проверенный результат.
 */
export async function prepareChange({
  start = process.cwd(),
  ticket,
  name,
  storeId: requestedStoreId,
  confirmArchivedChange,
  noStrict = false,
  commandRunner = runCommand,
} = {}) {
  const changeId = buildChangeId(ticket, name);
  const branch = `feature/${changeId}`;
  const store = await resolveChangeStore(start, commandRunner);
  const executionMode = resolveExecutionMode(store.config.strict, noStrict);
  if (requestedStoreId !== undefined && requestedStoreId !== store.storeId) {
    throw new Error(`Указан Store ${requestedStoreId}, текущий checkout принадлежит Store ${store.storeId}`);
  }
  const duplicates = await findDuplicates(store.projectRoot, ticket, store.activeChanges);
  const exact = duplicates.active.filter((candidate) => candidate === changeId);
  const conflicting = duplicates.active.filter((candidate) => candidate !== changeId);
  if (exact.length > 1 || conflicting.length > 0) {
    throw new Error(`Активный Change с ticket ${ticket} уже существует: ${duplicates.active.join(", ")}`);
  }

  let changeStatus;
  let statusResult;
  let git;
  if (exact.length === 1) {
    statusResult = await readChangeStatus(
      store.projectRoot,
      store.storeId,
      changeId,
      commandRunner,
    );
    git = executionMode === "strict"
      ? inspectContinuationChangeGit(
          store.projectRoot,
          store.config.storeRepository,
          branch,
          statusResult.changeRoot,
          commandRunner,
        )
      : { branch: null, revision: "unpinned" };
    changeStatus = "existing";
  } else {
    if (executionMode === "strict" && currentBranch(store.projectRoot, commandRunner) === branch) {
      throw new Error("needs_recovery: planning-ветка существует без Change");
    }
    if (duplicates.archived.length > 0) {
      if (typeof confirmArchivedChange !== "function") {
        throw new Error(`Найден архивный Change с ticket ${ticket}; требуется подтверждение в TTY`);
      }
      if (!(await confirmArchivedChange(duplicates.archived))) {
        throw new Error("Создание Change отменено: архивный ticket не подтверждён");
      }
    }
    git = executionMode === "strict"
      ? inspectInitialChangeGit(
          store.projectRoot,
          store.config.storeRepository,
          branch,
          commandRunner,
        )
      : { branch: null, revision: "unpinned" };
    if (executionMode === "strict") {
      commandRunner("git", ["switch", "-c", branch], { cwd: store.projectRoot });
    }
    const created = runOpenSpecJson(
      commandRunner,
      [
        "new",
        "change",
        changeId,
        "--store",
        store.storeId,
        "--json",
      ],
      store.projectRoot,
    );
    const createdChange = await assertCreatedChange(created, {
      projectRoot: store.projectRoot,
      storeId: store.storeId,
      changeId,
    });
    statusResult = await readChangeStatus(
      store.projectRoot,
      store.storeId,
      changeId,
      commandRunner,
      createdChange,
    );
    changeStatus = "created";
    if (executionMode === "strict") git = { ...git, branch };
  }
  return {
    changeStatus,
    executionMode,
    storeId: store.storeId,
    storeRoot: store.projectRoot,
    ticket,
    changeId,
    branch: git.branch,
    baseRevision: git.revision,
    changePath: statusResult.changeRoot,
    schema: statusResult.schema,
    nextArtifact: statusResult.nextArtifact,
    openSpecStatus: statusResult.status,
  };
}
