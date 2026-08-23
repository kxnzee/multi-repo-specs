/** @fileoverview One application facade for all Change Tracking operations. */

import { assertChangeId, isGitRevision } from "./contracts.js";
import { CycleRecord } from "./cycle-record.js";
import { CycleRecordRepository } from "./cycle-record-repository.js";

/** Returns whether two repository lists contain the same IDs regardless of order. */
function sameRepositorySet(left, right) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((repositoryId) => values.has(repositoryId));
}

/** Validates the Store-scoped public PluginContext used by Change Tracking. */
function assertContext(context) {
  if (
    !context ||
    context.repository?.role !== "store" ||
    typeof context.repositories?.require !== "function" ||
    typeof context.repositories?.requireConnected !== "function" ||
    typeof context.git?.statusPaths !== "function" ||
    typeof context.git?.revision !== "function" ||
    typeof context.git?.assertNoOperation !== "function"
  ) {
    throw new Error("CHANGE_TRACKING_CONTEXT_INVALID: требуется Store PluginContext");
  }
}

/** Validates one requested Code Repository before checking its Plugin binding. */
function requireCodeRepository(context, repositoryId) {
  const repository = context.repositories.require(repositoryId);
  if (repository.role !== "code") {
    throw new Error(
      `REPO_UNKNOWN: repository-id '${repositoryId}' — это Store, ` +
        "Cycle принимает только roles: [code]",
    );
  }
  return repository;
}

/** Validates repositories referenced by an already persisted Cycle. */
function assertCycleRepositories(context, cycle) {
  if (new Set(cycle.repositories).size !== cycle.repositories.length) {
    throw new Error("STATE_CORRUPTED: Cycle Record содержит повторяющийся repository-id");
  }
  for (const repositoryId of cycle.repositories) {
    let repository;
    try {
      repository = context.repositories.require(repositoryId);
    } catch {
      throw new Error(
        `STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository '${repositoryId}'`,
      );
    }
    if (repository.role !== "code") {
      throw new Error(
        `STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository '${repositoryId}'`,
      );
    }
  }
  context.repositories.requireConnected(cycle.repositories);
}

/** Store-scoped Change Tracking facade built only on the public PluginContext contract. */
export class ChangeTrackingService {
  #context;
  #records;

  /** @param {object} context Store-scoped public PluginContext. */
  constructor(context) {
    assertContext(context);
    this.#context = context;
    this.#records = new CycleRecordRepository(context.files);
    Object.freeze(this);
  }

  /**
   * Reads the current Cycle and determines whether its Git-tracked record is committed.
   *
   * @param {string} changeId Change ID.
   * @returns {Promise<object>} Current Cycle context with a Store-relative path.
   */
  async currentCycle(changeId) {
    assertChangeId(changeId);
    const path = this.#records.pathFor(changeId);
    const cycle = await this.#records.read(changeId);
    if (!cycle) {
      throw new Error(
        `CYCLE_NOT_FOUND: нет Cycle Record для change-id '${changeId}' ` +
          "в рабочей копии Store",
      );
    }
    assertCycleRepositories(this.#context, cycle);
    const committed = (await this.#context.git.statusPaths([path])).length === 0;
    return Object.freeze({ cycle, committed, path });
  }

  /**
   * Creates, replaces or preserves the current Cycle Record after preview confirmation.
   *
   * @param {object} input Assign input.
   * @param {string} input.changeId Change ID.
   * @param {readonly string[]} input.repositoryIds Requested Code Repository IDs.
   * @param {(preview: object) => Promise<boolean>} input.confirm Preview confirmation.
   * @returns {Promise<object>} Assign result with a Store-relative path.
   */
  async assign({ changeId, repositoryIds, confirm }) {
    assertChangeId(changeId);
    if (!Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      throw new Error("assign требует минимум один --repo");
    }
    if (new Set(repositoryIds).size !== repositoryIds.length) {
      throw new Error("REPO_UNKNOWN: один и тот же --repo передан дважды");
    }
    if (typeof confirm !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: confirm должен быть функцией");
    }
    for (const repositoryId of repositoryIds) {
      requireCodeRepository(this.#context, repositoryId);
    }
    this.#context.repositories.requireConnected(repositoryIds);

    await this.#context.git.assertNoOperation();
    const relativePath = this.#records.pathFor(changeId);
    const changedPaths = await this.#context.git.statusPaths();
    if (changedPaths.some((changedPath) => changedPath !== relativePath)) {
      throw new Error(
        `STORE_DIRTY: рабочее дерево Store должно быть чистым (кроме ${relativePath})`,
      );
    }
    const planningRevision = await this.#context.git.revision();
    if (!isGitRevision(planningRevision)) {
      throw new Error("Git вернул некорректную ревизию рабочей копии Store");
    }

    const existing = await this.#records.read(changeId);
    if (existing) {
      assertCycleRepositories(this.#context, existing);
      if (
        existing.planningRevision === planningRevision &&
        sameRepositorySet(existing.repositories, repositoryIds)
      ) {
        return Object.freeze({ status: "unchanged", cycle: existing, path: relativePath });
      }
    }

    const proceed = await confirm(Object.freeze({
      kind: existing ? "replace" : "create",
      changeId,
      path: relativePath,
      ...(existing ? { existing } : {}),
      planningRevision,
      repositories: Object.freeze([...repositoryIds]),
    }));
    if (!proceed) return Object.freeze({ status: "cancelled", path: relativePath });

    const cycle = CycleRecord.create({
      changeId,
      planningRevision,
      repositories: repositoryIds,
    });
    await this.#records.write(cycle);
    return Object.freeze({
      status: existing ? "replaced" : "created",
      cycle,
      path: relativePath,
    });
  }
}
