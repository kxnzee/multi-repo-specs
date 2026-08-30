/** @fileoverview One application facade for all Change Tracking operations. */

import { randomUUID } from "node:crypto";

import {
  assertChangeId,
  CHANGE_TRACKING_CONTRACT,
  CHANGE_TRACKING_RECEIPT_SOURCE,
  CHANGE_TRACKING_VERIFICATION_RESULT,
  isGitRevision,
} from "./contracts.js";
import { CycleRecord } from "./cycle-record.js";
import { CycleRecordRepository } from "./cycle-record-repository.js";
import {
  activeChangeIds,
  isChangeApplyReady,
  requireOpenSpec11,
} from "./openspec-compatibility.js";
import { parseRepositoryImpactRepositories } from "./repository-impact.js";
import { snapshotId } from "./snapshot-identity.js";
import { TrackingRepository } from "./tracking-repository.js";

/** Creates one stable repository evidence row without repeating nullable Git details. */
function repositoryEvidence(repositoryId, receipt = null, details = {}) {
  return Object.freeze({
    repositoryId,
    receipt,
    connected: null,
    commitAvailable: null,
    head: null,
    headMatches: null,
    ...details,
  });
}

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
    typeof context.repositories?.isConnected !== "function" ||
    typeof context.repositories?.requireConnected !== "function" ||
    typeof context.repositories?.git !== "function" ||
    typeof context.git?.statusPaths !== "function" ||
    typeof context.git?.latestRevision !== "function" ||
    typeof context.git?.assertNoOperation !== "function" ||
    typeof context.process?.run !== "function" ||
    typeof context.files?.listFiles !== "function" ||
    typeof context.files?.read !== "function"
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
function assertCycleRepositories(context, cycle, { requireConnected = true } = {}) {
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
  if (requireConnected) context.repositories.requireConnected(cycle.repositories);
}

/** Finds one current Result Receipt in the compiled Cycle receipt set. */
function resultFor(receipts, repositoryId) {
  return receipts.find((receipt) => receipt.repository_id === repositoryId) ?? null;
}

/** Returns the submitted implementation set required by one Snapshot. */
function submittedImplementations(cycle, receipts) {
  return Object.freeze([...cycle.repositories].sort().map((repositoryId) => {
    const receipt = resultFor(receipts, repositoryId);
    if (!receipt) {
      throw new Error(
        `CYCLE_MISMATCH: для repository-id '${repositoryId}' ` +
          "нужен текущий Result Receipt с implementation revision",
      );
    }
    return Object.freeze({
      repository_id: repositoryId,
      implementation_revision: receipt.implementation_revision,
      receipt_id: receipt.receipt_id,
    });
  }));
}

/** Compiles one deterministic Snapshot without persisting a second copy of derived state. */
function compileSnapshot(cycle, receipts) {
  const implementations = submittedImplementations(cycle, receipts);
  return Object.freeze({
    contract_version: CHANGE_TRACKING_CONTRACT.snapshotVersion,
    snapshot_id: snapshotId(cycle.cycleId, implementations),
    cycle_id: cycle.cycleId,
    implementations: Object.freeze(Object.fromEntries(implementations.map((implementation) => [
      implementation.repository_id,
      implementation.implementation_revision,
    ]))),
    receipts: Object.freeze(Object.fromEntries(implementations.map((implementation) => [
      implementation.repository_id,
      implementation.receipt_id,
    ]))),
    created_at: receipts
      .filter((receipt) => receipt.cycle_id === cycle.cycleId)
      .map((receipt) => receipt.created_at)
      .sort()
      .at(-1) ?? cycle.createdAt,
  });
}

/** Store-scoped Change Tracking facade built only on the public PluginContext contract. */
export class ChangeTrackingService {
  #context;
  #records;
  #tracking;

  /** @param {object} context Store-scoped public PluginContext. */
  constructor(context) {
    assertContext(context);
    this.#context = context;
    this.#records = new CycleRecordRepository(context.files);
    this.#tracking = new TrackingRepository(context.files);
    Object.freeze(this);
  }

  /**
   * Creates the current Cycle from the accepted Proposal Repository Impact.
   *
   * @param {object} input Track input.
   * @param {string} input.changeId Change ID.
   * @returns {Promise<object>} Track result with the derived repository scope.
   */
  async track({ changeId }) {
    assertChangeId(changeId);
    await requireOpenSpec11(this.#context.process);
    if (!await isChangeApplyReady(this.#context.process, changeId)) {
      throw new Error(
        `PLANNING_INCOMPLETE: Change '${changeId}' ещё не завершил OpenSpec Planning`,
      );
    }
    const proposalPath = `openspec/changes/${changeId}/proposal.md`;
    const proposal = await this.#context.files.read(proposalPath, { optional: true });
    if (proposal === null) {
      throw new Error(
        `REPOSITORY_IMPACT_INVALID: Change '${changeId}': отсутствует ${proposalPath}`,
      );
    }
    const repositoryIds = parseRepositoryImpactRepositories(proposal, changeId);
    const result = await this.#createCycle({ changeId, repositoryIds });
    return Object.freeze({ ...result, repositoryIds });
  }

  /**
   * Records the current Repository HEAD and compiles a Snapshot when the scope is complete.
   *
   * @param {object} input Done input.
   * @param {string} [input.changeId] Explicit Change selector for an ambiguous Repository.
   * @param {string} [input.implementationRevision] Emergency exact commit override.
   * @param {"human" | "agent" | "ci"} input.source Result source.
   * @returns {Promise<object>} Recorded result and optional current Snapshot.
   */
  async done({ changeId, implementationRevision, source }) {
    await requireOpenSpec11(this.#context.process);
    const invocation = this.#context.invocation;
    if (!invocation || invocation.role !== "code") {
      throw new Error("DONE_CONTEXT_INVALID: вызовите done из каталога Code Repository");
    }
    const repositoryId = invocation.id;
    const cycle = await this.#resolveRepositoryCycle(repositoryId, changeId);
    const repositoryGit = await this.#context.repositories.git(repositoryId);
    if (!repositoryGit) {
      throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${repositoryId}`);
    }
    const changedPaths = await repositoryGit.statusPaths();
    if (changedPaths.length > 0) {
      throw new Error(
        `WORKTREE_DIRTY: ${repositoryId} содержит незакоммиченные изменения: ` +
          changedPaths.join(", "),
      );
    }
    const revision = implementationRevision ?? await repositoryGit.revision();
    const result = await this.#recordRevision({
      changeId: cycle.changeId,
      repositoryId,
      implementationRevision: revision,
      repositoryGit,
      source,
    });
    const remoteReachable = await repositoryGit.isRemoteReachable(revision);
    const receipts = await this.#tracking.resultsForCycle(cycle.changeId, cycle);
    const allSubmitted = receipts.length === cycle.repositories.length;
    const snapshot = allSubmitted ? compileSnapshot(cycle, receipts) : null;
    return Object.freeze({
      changeId: cycle.changeId,
      repositoryId,
      result,
      remoteReachable,
      snapshot,
    });
  }

  /** Records one explicit human/CI decision for the current automatically resolved Snapshot. */
  async verifyResult({ changeId, result, source, note }) {
    await requireOpenSpec11(this.#context.process);
    const cycle = await this.#resolveVerificationCycle(changeId);
    const recorded = await this.#recordVerification({
      changeId: cycle.changeId,
      result,
      source,
      note,
    });
    return Object.freeze({
      changeId: cycle.changeId,
      receipt: recorded.receipt,
      path: recorded.path,
    });
  }

  /**
   * Reads the current Cycle and determines whether its Git-tracked record is committed.
   *
   * @param {string} changeId Change ID.
   * @returns {Promise<object>} Current Cycle context with a Store-relative path.
   */
  async #currentCycle(changeId, { requireConnected = true } = {}) {
    assertChangeId(changeId);
    const path = this.#records.pathFor(changeId);
    const cycle = await this.#records.read(changeId);
    if (!cycle) {
      throw new Error(
        `CYCLE_NOT_FOUND: нет Cycle Record для change-id '${changeId}' ` +
          "в рабочей копии Store",
      );
    }
    assertCycleRepositories(this.#context, cycle, { requireConnected });
    const committed = (await this.#context.git.statusPaths([path])).length === 0;
    return Object.freeze({ cycle, committed, path });
  }

  /** Records one implementation revision for the public done flow. */
  async #recordRevision({
    changeId,
    repositoryId,
    implementationRevision,
    repositoryGit,
    source,
  }) {
    if (!isGitRevision(implementationRevision)) {
      throw new Error("COMMIT_NOT_FOUND: --sha должен быть полной lowercase SHA-1 ревизией");
    }
    const current = await this.#committedCycle(changeId);
    if (!current.cycle.repositories.includes(repositoryId)) {
      throw new Error(`REPO_UNKNOWN: repository-id '${repositoryId}' не входит в текущий Cycle`);
    }
    const available = await repositoryGit.hasCommit(implementationRevision);
    if (!available) {
      throw new Error(
        `COMMIT_NOT_FOUND: commit ${implementationRevision} не существует в ${repositoryId}`,
      );
    }

    const existing = await this.#tracking.latestResult(
      changeId,
      current.cycle.cycleId,
      repositoryId,
    );
    const candidate = {
      contract_version: CHANGE_TRACKING_CONTRACT.resultReceiptVersion,
      receipt_id: `${CHANGE_TRACKING_CONTRACT.resultPrefix}${randomUUID()}`,
      cycle_id: current.cycle.cycleId,
      repository_id: repositoryId,
      implementation_revision: implementationRevision,
      source,
      supersedes: existing?.receipt_id ?? null,
      created_at: new Date().toISOString(),
    };
    const latestCycle = await this.#currentCycle(changeId);
    if (!latestCycle.committed || latestCycle.cycle.cycleId !== current.cycle.cycleId) {
      throw new Error("CYCLE_MISMATCH: текущий Cycle изменился во время команды; повторите команду");
    }
    return this.#tracking.appendResult(
      changeId,
      candidate,
      existing?.receipt_id ?? null,
    );
  }

  /** Records external verification for the Snapshot selected by the public verify flow. */
  async #recordVerification({ changeId, result, source, note }) {
    if (![
      CHANGE_TRACKING_RECEIPT_SOURCE.human,
      CHANGE_TRACKING_RECEIPT_SOURCE.ci,
    ].includes(source)) {
      throw new Error("VERIFY_SOURCE_INVALID: решение проверки может принять только human или ci");
    }
    const current = await this.#committedCycle(changeId);
    const receipts = await this.#tracking.resultsForCycle(changeId, current.cycle);
    let snapshot;
    try {
      snapshot = compileSnapshot(current.cycle, receipts);
    } catch (error) {
      throw new Error(`SNAPSHOT_MISMATCH: ${error.message}`);
    }
    const existing = await this.#tracking.latestVerification(changeId, current.cycle.cycleId);
    const candidate = {
      contract_version: CHANGE_TRACKING_CONTRACT.verificationReceiptVersion,
      receipt_id: `${CHANGE_TRACKING_CONTRACT.verificationPrefix}${randomUUID()}`,
      cycle_id: current.cycle.cycleId,
      snapshot_id: snapshot.snapshot_id,
      result,
      source,
      supersedes: existing?.receipt_id ?? null,
      ...(note ? { note } : {}),
      created_at: new Date().toISOString(),
    };
    const latest = await this.#committedCycle(changeId);
    const latestReceipts = await this.#tracking.resultsForCycle(changeId, latest.cycle);
    if (
      latest.cycle.cycleId !== current.cycle.cycleId ||
      compileSnapshot(latest.cycle, latestReceipts).snapshot_id !== candidate.snapshot_id
    ) {
      throw new Error("SNAPSHOT_MISMATCH: текущий Snapshot изменился во время команды; повторите команду");
    }
    return this.#tracking.appendVerification(
      changeId,
      candidate,
      existing?.receipt_id ?? null,
    );
  }

  /**
   * Reads current implementation evidence without mutating Store or repositories.
   *
   * @param {string} changeId Change ID.
   * @returns {Promise<object>} Current Change Tracking status.
   */
  async status(changeId) {
    await requireOpenSpec11(this.#context.process);
    return this.#readStatus(changeId);
  }

  /** Reads every active OpenSpec Change with an optional current tracking overlay. */
  async statuses() {
    await requireOpenSpec11(this.#context.process);
    const [changeIds, cycles] = await Promise.all([
      activeChangeIds(this.#context.process),
      this.#records.list(),
    ]);
    const tracked = new Set(cycles.map(({ changeId }) => changeId));
    return Object.freeze(await Promise.all(changeIds.map(async (changeId) => (
      tracked.has(changeId)
        ? Object.freeze({ ...await this.#readStatus(changeId), tracked: true })
        : Object.freeze({ changeId, tracked: false })
    ))));
  }

  /** Builds the detailed overlay for one tracked Change without another OpenSpec call. */
  async #readStatus(changeId) {
    const current = await this.#currentCycle(changeId, { requireConnected: false });
    const receipts = await this.#tracking.resultsForCycle(changeId, current.cycle);
    const repositories = Object.freeze(await Promise.all(
      current.cycle.repositories.map(async (repositoryId) => {
        const receipt = resultFor(receipts, repositoryId);
        const connected = this.#context.repositories.isConnected(repositoryId);
        if (!receipt || !connected) {
          return repositoryEvidence(repositoryId, receipt, { connected });
        }
        const repositoryGit = await this.#context.repositories.git(repositoryId);
        if (!repositoryGit) {
          return repositoryEvidence(repositoryId, receipt, {
            connected: true,
            commitAvailable: false,
          });
        }
        const [head, available] = await Promise.all([
          repositoryGit.revision(),
          repositoryGit.hasCommit(receipt.implementation_revision),
        ]);
        return repositoryEvidence(
          repositoryId,
          receipt,
          {
            connected: true,
            commitAvailable: available,
            head,
            headMatches: head === receipt.implementation_revision,
          },
        );
      }),
    ));
    const allSubmitted = receipts.length === current.cycle.repositories.length;
    const snapshot = allSubmitted
      ? Object.freeze({ ...compileSnapshot(current.cycle, receipts), current: true })
      : null;
    const storedVerification = await this.#tracking.latestVerification(
      changeId,
      current.cycle.cycleId,
    );
    const verification = storedVerification
      ? Object.freeze({
        ...storedVerification,
        current: Boolean(snapshot && storedVerification.snapshot_id === snapshot.snapshot_id),
      })
      : null;
    const releaseReady = current.committed &&
      snapshot?.current === true &&
      verification?.current === true &&
      verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.pass;
    return Object.freeze({
      changeId,
      cycle: current.cycle,
      committed: current.committed,
      path: current.path,
      repositories,
      snapshot,
      verification,
      releaseReady,
    });
  }

  /** Resolves one active Cycle containing the current Code Repository. */
  async #resolveRepositoryCycle(repositoryId, changeId) {
    if (changeId !== undefined) {
      const current = await this.#currentCycle(changeId);
      if (!current.cycle.repositories.includes(repositoryId)) {
        throw new Error(
          `REPO_UNKNOWN: repository-id '${repositoryId}' не входит в Change '${changeId}'`,
        );
      }
      return current.cycle;
    }
    const candidates = (await this.#activeCycles())
      .filter((record) => record.repositories.includes(repositoryId));
    if (candidates.length === 0) {
      throw new Error(`CYCLE_NOT_FOUND: для repository-id '${repositoryId}' нет активного Cycle`);
    }
    if (candidates.length > 1) {
      throw new Error(
        `CYCLE_AMBIGUOUS: repository-id '${repositoryId}' входит в Changes: ` +
          `${candidates.map(({ changeId: id }) => id).join(", ")}; укажите --change`,
      );
    }
    return candidates[0];
  }

  /** Resolves one active Cycle for Change-level verification. */
  async #resolveVerificationCycle(changeId) {
    if (changeId !== undefined) return (await this.#currentCycle(changeId)).cycle;
    if (this.#context.invocation?.role === "code") {
      return this.#resolveRepositoryCycle(this.#context.invocation.id);
    }
    const candidates = await this.#activeCycles();
    if (candidates.length === 0) {
      throw new Error("CYCLE_NOT_FOUND: нет активного Cycle для проверки");
    }
    if (candidates.length > 1) {
      throw new Error(
        `CYCLE_AMBIGUOUS: активны Changes: ` +
          `${candidates.map(({ changeId: id }) => id).join(", ")}; укажите --change`,
      );
    }
    return candidates[0];
  }

  /** Lists Cycle Records whose Changes still exist in the active Store directory. */
  async #activeCycles() {
    const records = await this.#records.list();
    const activeChanges = new Set(await activeChangeIds(this.#context.process));
    return Object.freeze(records.filter((record) => activeChanges.has(record.changeId)));
  }

  /** Возвращает текущий Cycle только после общей проверки его commit gate. */
  async #committedCycle(changeId) {
    const current = await this.#currentCycle(changeId);
    if (!current.committed) {
      throw new Error(
        "CYCLE_NOT_COMMITTED: сначала закоммитьте Cycle Record обычным процессом Git",
      );
    }
    return current;
  }

  /** Creates, replaces or preserves the Cycle derived by the public track flow. */
  async #createCycle({ changeId, repositoryIds }) {
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
    const planningRevision = await this.#context.git.latestRevision([
      `openspec/changes/${changeId}`,
    ]);
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
        return Object.freeze({ changed: false, cycle: existing, path: relativePath });
      }
    }

    const cycle = CycleRecord.create({
      changeId,
      planningRevision,
      repositories: repositoryIds,
    });
    await this.#records.write(cycle);
    return Object.freeze({
      changed: true,
      cycle,
      path: relativePath,
    });
  }
}
