/** @fileoverview Shared Change Tracking application API for CLI and machine adapters. */

import { ChangeTrackingService } from "./service.js";

/** Produces the stable machine-readable status projection. */
export function formatStatusJson(status, currentRepository) {
  return Object.freeze({
    change_id: status.changeId,
    tracked: true,
    cycle_id: status.cycle.cycleId,
    planning_revision: status.cycle.planningRevision,
    repositories: status.cycle.repositories,
    committed: status.committed,
    current_repository: currentRepository
      ? Object.freeze({
        repository_id: currentRepository.id,
        role: currentRepository.role,
        path: currentRepository.path,
        in_cycle: status.cycle.repositories.includes(currentRepository.id),
      })
      : null,
    results: Object.freeze(status.repositories.map((repository) => Object.freeze({
      repository_id: repository.repositoryId,
      implementation_revision: repository.receipt?.implementation_revision ?? null,
      source: repository.receipt?.source ?? null,
      connected: repository.connected,
      commit_available: repository.commitAvailable,
      head: repository.head,
      head_matches: repository.headMatches,
    }))),
    snapshot: status.snapshot,
    verification: status.verification,
    release_ready: status.releaseReady,
  });
}

/** Selects one current Change conservatively instead of guessing across several Changes. */
function selectStatus(statuses, invocation, changeId) {
  if (changeId) {
    const selected = statuses.find((status) => status.changeId === changeId);
    if (!selected) throw new Error(`CHANGE_NOT_FOUND: ${changeId}`);
    return selected;
  }
  const relevant = invocation?.role === "code"
    ? statuses.filter((status) => status.tracked && status.cycle.repositories.includes(invocation.id))
    : statuses;
  if (relevant.length === 1) return relevant[0];
  if (relevant.length === 0) return null;
  throw new Error(
    `CHANGE_AMBIGUOUS: укажите change_id; доступны ${relevant.map(({ changeId: id }) => id).join(", ")}`,
  );
}

/** Creates one next-action result without granting a capability to execute it. */
function action(id, actor, reason, details = {}) {
  return Object.freeze({ action: id, actor, reason, ...details });
}

/** Derives the next Change Tracking action from the same status model used by CLI. */
function nextAction(status, invocation) {
  if (!status) return action("none", "human", "Нет активного Change в текущем scope");
  if (!status.tracked) {
    return action("track_change", "human", "Change ещё не имеет опубликованного evidence scope", {
      change_id: status.changeId,
    });
  }
  if (!status.committed) {
    return action("publish_cycle", "human", "Cycle Record должен быть опубликован Git-процессом", {
      change_id: status.changeId,
    });
  }
  if (invocation?.role === "code") {
    if (!status.cycle.repositories.includes(invocation.id)) {
      return action("out_of_scope", "human", "Текущий Code Repository не входит в Cycle", {
        change_id: status.changeId,
        repository_id: invocation.id,
      });
    }
    const current = status.repositories.find(({ repositoryId }) => repositoryId === invocation.id);
    if (!current?.receipt || current.headMatches === false) {
      return action(
        "record_result_receipt",
        "agent",
        current?.receipt ? "Текущий HEAD отличается от последнего receipt" : "Для Repository ещё нет receipt",
        { change_id: status.changeId, repository_id: invocation.id },
      );
    }
  }
  const missing = status.repositories
    .filter(({ receipt }) => receipt === null)
    .map(({ repositoryId }) => repositoryId);
  if (missing.length > 0) {
    return action("await_repository_receipts", "agent_or_human", "Не все части Cycle передали receipt", {
      change_id: status.changeId,
      repository_ids: Object.freeze(missing),
    });
  }
  if (!status.verification || !status.verification.current) {
    return action("verify_snapshot", "human_or_ci", "Текущий Snapshot требует внешней проверки", {
      change_id: status.changeId,
      snapshot_id: status.snapshot?.snapshot_id ?? null,
    });
  }
  if (status.verification.result === "fail") {
    return action("address_verification_failure", "human", "Текущий Snapshot не прошёл проверку", {
      change_id: status.changeId,
      snapshot_id: status.snapshot?.snapshot_id ?? null,
    });
  }
  return action("release", "human", "Snapshot проверен; решение о Release остаётся человеку", {
    change_id: status.changeId,
    snapshot_id: status.snapshot?.snapshot_id ?? null,
  });
}

/** Shared application facade; transport adapters do not own tracking policy. */
export class ChangeTrackingApplication {
  #context;
  #service;

  constructor(context, { service = new ChangeTrackingService(context) } = {}) {
    this.#context = context;
    this.#service = service;
    Object.freeze(this);
  }

  async getStatus(changeId) {
    const statuses = await this.#service.statuses();
    if (changeId) {
      const selected = selectStatus(statuses, this.#context.invocation, changeId);
      return selected.tracked
        ? formatStatusJson(selected, this.#context.invocation)
        : Object.freeze({ change_id: selected.changeId, tracked: false });
    }
    return Object.freeze({
      changes: Object.freeze(statuses.map((status) => status.tracked
        ? formatStatusJson(status, this.#context.invocation)
        : Object.freeze({ change_id: status.changeId, tracked: false }))),
    });
  }

  async getNextAction(changeId) {
    const statuses = await this.#service.statuses();
    return nextAction(selectStatus(statuses, this.#context.invocation, changeId), this.#context.invocation);
  }

  async getAssignmentScope(changeId) {
    const statuses = await this.#service.statuses();
    const status = selectStatus(statuses, this.#context.invocation, changeId);
    if (!status) return Object.freeze({ assigned: false, change: null });
    if (!status.tracked) {
      return Object.freeze({
        assigned: false,
        change: Object.freeze({ change_id: status.changeId, tracked: false }),
      });
    }
    const invocation = this.#context.invocation;
    const assigned = invocation?.role === "code" && status.cycle.repositories.includes(invocation.id);
    const current = invocation?.role === "code"
      ? status.repositories.find(({ repositoryId }) => repositoryId === invocation.id)
      : null;
    return Object.freeze({
      assigned,
      change: Object.freeze({
        change_id: status.changeId,
        cycle_id: status.cycle.cycleId,
        planning_revision: status.cycle.planningRevision,
        repositories: status.cycle.repositories,
      }),
      current_repository: invocation ? Object.freeze({
        repository_id: invocation.id,
        role: invocation.role,
        path: invocation.path,
        head: current?.head ?? null,
        head_matches_receipt: current?.headMatches ?? null,
      }) : null,
    });
  }
}
