/** @fileoverview Детерминированное создание или продолжение OpenSpec Change шага 02. */

import path from "node:path";
import process from "node:process";

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
  inspectChangeDirectory,
  readChangeStatus,
  resolveChangeStore,
} from "./store.js";

export { buildChangeId, validateChangeName } from "./id.js";

/**
 * Подготавливает стандартный Change, не создавая Proposal от имени CLI.
 *
 * @param {object} [options] Параметры команды.
 * @param {string} [options.start] Текущий каталог внутри центрального Store.
 * @param {string} options.ticket Jira ticket key.
 * @param {string} options.name Короткое lowercase kebab-case имя.
 * @param {(changes: string[]) => Promise<boolean> | boolean} [options.confirmArchivedChange]
 * Подтверждение повторной работы по архивному ticket.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель команд; переопределяется в тестах.
 * @returns {Promise<import("../shared/types.js").ChangePreparation>} Проверенный результат.
 */
export async function prepareChange({
  start = process.cwd(),
  ticket,
  name,
  confirmArchivedChange,
  commandRunner = runCommand,
} = {}) {
  const changeId = buildChangeId(ticket, name);
  const branch = `feature/${changeId}`;
  const store = await resolveChangeStore(start, commandRunner);
  const duplicates = await findDuplicates(store.projectRoot, ticket, store.activeChanges);
  const exact = duplicates.active.filter((candidate) => candidate === changeId);
  const conflicting = duplicates.active.filter((candidate) => candidate !== changeId);
  if (exact.length > 1 || conflicting.length > 0) {
    throw new Error(`Активный Change с ticket ${ticket} уже существует: ${duplicates.active.join(", ")}`);
  }

  let state = await inspectChangeDirectory(store.projectRoot, changeId);
  if (exact.length !== Number(state.exists)) {
    throw new Error("needs_recovery: OpenSpec list и каталог Change описывают разное состояние");
  }

  let changeStatus;
  let git;
  if (state.exists) {
    git = inspectContinuationChangeGit(
      store.projectRoot,
      store.config.storeRepository,
      branch,
      changeId,
      commandRunner,
    );
    changeStatus = "existing";
  } else {
    if (currentBranch(store.projectRoot, commandRunner) === branch) {
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
    git = inspectInitialChangeGit(
      store.projectRoot,
      store.config.storeRepository,
      branch,
      commandRunner,
    );
    commandRunner("git", ["switch", "-c", branch], { cwd: store.projectRoot });
    const created = runOpenSpecJson(
      commandRunner,
      [
        "new",
        "change",
        changeId,
        "--schema",
        "spec-driven",
        "--store",
        store.storeId,
        "--json",
      ],
      store.projectRoot,
    );
    const expectedRoot = path.join(store.projectRoot, "openspec", "changes", changeId);
    assertCreatedChange(created, {
      projectRoot: store.projectRoot,
      storeId: store.storeId,
      changeId,
      changeRoot: expectedRoot,
    });
    state = await inspectChangeDirectory(store.projectRoot, changeId);
    if (!state.exists) throw new Error("needs_recovery: OpenSpec не создал каталог Change");
    changeStatus = "created";
    git = { ...git, branch };
  }

  const openSpecStatus = readChangeStatus(
    store.projectRoot,
    store.storeId,
    changeId,
    state.changeRoot,
    state.proposalExists,
    commandRunner,
  );
  return {
    changeStatus,
    storeId: store.storeId,
    storeRoot: store.projectRoot,
    ticket,
    changeId,
    branch,
    baseRevision: git.revision,
    changePath: state.changeRoot,
    schema: "spec-driven",
    proposalStatus: state.proposalExists ? "present" : "missing",
    nextAction: state.proposalExists ? "review_proposal" : "create_proposal",
    openSpecStatus,
  };
}
