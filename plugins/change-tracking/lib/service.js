/** @fileoverview One application facade for all Change Tracking operations. */

import { randomUUID } from "node:crypto";

import { assertChangeId, isGitRevision } from "./contracts.js";
import { CycleRecord } from "./cycle-record.js";
import { CycleRecordRepository } from "./cycle-record-repository.js";
import { ChangeTrackingState, ChangeTrackingStore } from "./state.js";

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
    typeof context.repositories?.git !== "function" ||
    typeof context.git?.statusPaths !== "function" ||
    typeof context.git?.revision !== "function" ||
    typeof context.git?.assertNoOperation !== "function" ||
    typeof context.storage?.read !== "function" ||
    typeof context.storage?.update !== "function"
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
  #state;

  /** @param {object} context Store-scoped public PluginContext. */
  constructor(context) {
    assertContext(context);
    this.#context = context;
    this.#records = new CycleRecordRepository(context.files);
    this.#state = new ChangeTrackingStore(context.storage);
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
   * Records one implementation result for a Code Repository in the committed current Cycle.
   *
   * @param {object} input Result Receipt input.
   * @param {string} input.changeId Change ID.
   * @param {string} input.repositoryId Code Repository ID.
   * @param {string} input.implementationRevision Full implementation commit.
   * @param {"completed" | "failed" | "blocked"} input.status Result status.
   * @param {"human" | "agent" | "ci"} input.source Result source.
   * @param {string} [input.note] Optional note.
   * @param {(preview: object) => Promise<boolean>} input.confirm Preview confirmation.
   * @returns {Promise<object>} Created or replaced Result Receipt.
   */
  async recordAssignment({
    changeId,
    repositoryId,
    implementationRevision,
    status,
    source,
    note,
    confirm,
  }) {
    if (!isGitRevision(implementationRevision)) {
      throw new Error("COMMIT_NOT_FOUND: --commit должен быть полной lowercase SHA-1 ревизией");
    }
    if (typeof confirm !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: confirm должен быть функцией");
    }
    const current = await this.currentCycle(changeId);
    if (!current.committed) {
      throw new Error(
        "CYCLE_NOT_COMMITTED: сначала закоммитьте Cycle Record обычным процессом Git",
      );
    }
    if (!current.cycle.repositories.includes(repositoryId)) {
      throw new Error(`REPO_UNKNOWN: repository-id '${repositoryId}' не входит в текущий Cycle`);
    }
    const repositoryGit = await this.#context.repositories.git(repositoryId);
    if (!repositoryGit) {
      throw new Error(
        `COMMIT_NOT_FOUND: commit ${implementationRevision} не существует в ${repositoryId}`,
      );
    }
    const [head, available] = await Promise.all([
      repositoryGit.revision(),
      repositoryGit.hasCommit(implementationRevision),
    ]);
    if (!available) {
      throw new Error(
        `COMMIT_NOT_FOUND: commit ${implementationRevision} не существует в ${repositoryId}`,
      );
    }

    const state = await this.#state.read();
    const existing = state.result(current.cycle.cycleId, repositoryId);
    const candidate = {
      contract_version: 1,
      receipt_id: `result-${randomUUID()}`,
      cycle_id: current.cycle.cycleId,
      repository_id: repositoryId,
      implementation_revision: implementationRevision,
      status,
      source,
      ...(note ? { note } : {}),
      created_at: new Date().toISOString(),
    };
    const receipt = new ChangeTrackingState().recordResult(candidate)
      .result(current.cycle.cycleId, repositoryId);
    const proceed = await confirm(Object.freeze({ receipt, existing, head }));
    if (!proceed) return Object.freeze({ status: "cancelled" });

    await this.#state.update(async (latest) => {
      const latestCycle = await this.currentCycle(changeId);
      if (!latestCycle.committed || latestCycle.cycle.cycleId !== current.cycle.cycleId) {
        throw new Error("CYCLE_MISMATCH: текущий Cycle изменился после preview; повторите команду");
      }
      const latestExisting = latest.result(current.cycle.cycleId, repositoryId);
      if ((latestExisting?.receipt_id ?? null) !== (existing?.receipt_id ?? null)) {
        throw new Error(
          "CYCLE_MISMATCH: текущий Result Receipt изменился после preview; повторите команду",
        );
      }
      return latest.recordResult(receipt);
    });
    return Object.freeze({
      status: existing ? "replaced" : "created",
      receipt,
      replaced: existing ?? null,
      headMatches: head === implementationRevision,
    });
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
