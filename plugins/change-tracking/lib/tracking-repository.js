/** @fileoverview Git-tracked append-only evidence journals inside the shared Store. */

import { parse, stringify } from "yaml";

import {
  CHANGE_TRACKING_CONTRACT,
  parseResultReceiptDocument,
  parseVerificationReceiptDocument,
} from "./contracts.js";

/** Fails one malformed Git-tracked document with its stable Store-relative path. */
function corrupted(relativePath, message) {
  throw new Error(`STATE_CORRUPTED: ${relativePath}: ${message}`);
}

/** Reads one strict versioned YAML journal and returns its entries. */
async function readJournal(files, relativePath, { collection, label, version }) {
  const source = await files.read(relativePath, { optional: true });
  if (source === null) return Object.freeze([]);
  let document;
  try {
    document = parse(source);
  } catch (error) {
    corrupted(relativePath, `некорректный YAML: ${error.message}`);
  }
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    document.contract_version !== version ||
    !Array.isArray(document[collection]) ||
    Object.keys(document).some((key) => !["contract_version", collection].includes(key))
  ) {
    corrupted(relativePath, `ожидается ${label} journal v${version}`);
  }
  return document[collection];
}

/** Repository for per-Code-Repository append-only Result Receipt journals. */
export class TrackingRepository {
  #files;

  constructor(files) {
    if (
      !files ||
      typeof files.read !== "function" ||
      typeof files.write !== "function" ||
      typeof files.listFiles !== "function"
    ) {
      throw new Error("CHANGE_TRACKING_INVALID: требуется Files facade");
    }
    this.#files = files;
    Object.freeze(this);
  }

  #receiptPath(changeId, repositoryId) {
    return `${CHANGE_TRACKING_CONTRACT.trackingDirectory}/${changeId}/receipts/` +
      `${repositoryId}.yaml`;
  }

  #verificationPath(changeId, snapshotId) {
    return `${CHANGE_TRACKING_CONTRACT.trackingDirectory}/${changeId}/verification/` +
      `${snapshotId}.yaml`;
  }

  async latestResult(changeId, cycleId, repositoryId) {
    const receipts = await this.#readResultJournal(changeId, repositoryId);
    return receipts.findLast((receipt) => receipt.cycle_id === cycleId) ?? null;
  }

  async resultsForCycle(changeId, cycle) {
    const directory = `${CHANGE_TRACKING_CONTRACT.trackingDirectory}/${changeId}/receipts`;
    const names = await this.#files.listFiles(directory, { optional: true });
    const known = new Set(cycle.repositories.map((repositoryId) => `${repositoryId}.yaml`));
    for (const name of names) {
      if (!known.has(name)) corrupted(`${directory}/${name}`, "неизвестный repository receipt");
    }
    const receipts = [];
    for (const repositoryId of cycle.repositories) {
      const receipt = await this.latestResult(changeId, cycle.cycleId, repositoryId);
      if (receipt) receipts.push(receipt);
    }
    return Object.freeze(receipts);
  }

  async appendResult(changeId, receipt, expectedReceiptId) {
    const relativePath = this.#receiptPath(changeId, receipt.repository_id);
    const receipts = await this.#readResultJournal(changeId, receipt.repository_id);
    const existing = receipts.findLast((candidate) => (
      candidate.cycle_id === receipt.cycle_id
    )) ?? null;
    if ((existing?.receipt_id ?? null) !== expectedReceiptId) {
      throw new Error(
        "CYCLE_MISMATCH: текущий Result Receipt изменился во время команды; повторите команду",
      );
    }
    if ((receipt.supersedes ?? null) !== expectedReceiptId) {
      throw new Error("CHANGE_TRACKING_INVALID: supersedes не соответствует текущему receipt");
    }
    const checked = parseResultReceiptDocument(receipt);
    await this.#files.write(relativePath, stringify({
      contract_version: CHANGE_TRACKING_CONTRACT.resultReceiptVersion,
      receipts: [...receipts, checked],
    }));
    return Object.freeze({ path: relativePath, receipt: checked });
  }

  async latestVerification(changeId, cycleId) {
    const directory = `${CHANGE_TRACKING_CONTRACT.trackingDirectory}/${changeId}/verification`;
    const names = await this.#files.listFiles(directory, { optional: true });
    const receipts = [];
    for (const name of names) {
      if (!name.endsWith(".yaml")) corrupted(`${directory}/${name}`, "ожидается YAML journal");
      receipts.push(...await this.#readVerificationJournal(`${directory}/${name}`));
    }
    const current = receipts.filter((receipt) => receipt.cycle_id === cycleId);
    if (current.length === 0) return null;
    const roots = current.filter((receipt) => receipt.supersedes === null);
    const children = new Map();
    for (const receipt of current.filter((candidate) => candidate.supersedes !== null)) {
      if (children.has(receipt.supersedes)) {
        corrupted(directory, "verification содержит расходящуюся цепочку supersedes");
      }
      children.set(receipt.supersedes, receipt);
    }
    if (roots.length !== 1) {
      corrupted(directory, "verification должна содержать одну цепочку supersedes");
    }
    let latest = roots[0];
    const visited = new Set([latest.receipt_id]);
    while (children.has(latest.receipt_id)) {
      latest = children.get(latest.receipt_id);
      if (visited.has(latest.receipt_id)) {
        corrupted(directory, "verification содержит цикл supersedes");
      }
      visited.add(latest.receipt_id);
    }
    if (visited.size !== current.length) {
      corrupted(directory, "verification содержит разорванную цепочку supersedes");
    }
    return latest;
  }

  async appendVerification(changeId, receipt, expectedReceiptId) {
    const latest = await this.latestVerification(changeId, receipt.cycle_id);
    if ((latest?.receipt_id ?? null) !== expectedReceiptId) {
      throw new Error(
        "SNAPSHOT_MISMATCH: текущая verification изменилась во время команды; повторите команду",
      );
    }
    if ((receipt.supersedes ?? null) !== expectedReceiptId) {
      throw new Error("CHANGE_TRACKING_INVALID: supersedes не соответствует текущей verification");
    }
    const relativePath = this.#verificationPath(changeId, receipt.snapshot_id);
    const receipts = await this.#readVerificationJournal(relativePath);
    const checked = parseVerificationReceiptDocument(receipt);
    if (receipts.some((candidate) => candidate.receipt_id === checked.receipt_id)) {
      corrupted(relativePath, "receipt_id повторяется");
    }
    await this.#files.write(relativePath, stringify({
      contract_version: CHANGE_TRACKING_CONTRACT.verificationReceiptVersion,
      verifications: [...receipts, checked],
    }));
    return Object.freeze({ path: relativePath, receipt: checked });
  }

  async #readResultJournal(changeId, repositoryId) {
    const relativePath = this.#receiptPath(changeId, repositoryId);
    const candidates = await readJournal(this.#files, relativePath, {
      collection: "receipts",
      label: "Result Receipt",
      version: CHANGE_TRACKING_CONTRACT.resultReceiptVersion,
    });
    const receipts = [];
    const ids = new Set();
    const latestByCycle = new Map();
    for (const candidate of candidates) {
      if (candidate?.repository_id !== repositoryId) {
        corrupted(relativePath, "repository_id не соответствует имени файла");
      }
      const checked = parseResultReceiptDocument(candidate);
      const existing = latestByCycle.get(checked.cycle_id) ?? null;
      if ((candidate?.supersedes ?? null) !== (existing?.receipt_id ?? null)) {
        corrupted(relativePath, "нарушена цепочка supersedes");
      }
      if (ids.has(checked.receipt_id)) corrupted(relativePath, "receipt_id повторяется");
      ids.add(checked.receipt_id);
      latestByCycle.set(checked.cycle_id, checked);
      receipts.push(checked);
    }
    return Object.freeze(receipts);
  }

  async #readVerificationJournal(relativePath) {
    const candidates = await readJournal(this.#files, relativePath, {
      collection: "verifications",
      label: "Verification",
      version: CHANGE_TRACKING_CONTRACT.verificationReceiptVersion,
    });
    const receipts = [];
    const ids = new Set();
    for (const candidate of candidates) {
      const checked = parseVerificationReceiptDocument(candidate);
      if (!relativePath.endsWith(`/${checked.snapshot_id}.yaml`)) {
        corrupted(relativePath, "snapshot_id не соответствует имени файла");
      }
      if (ids.has(checked.receipt_id)) corrupted(relativePath, "receipt_id повторяется");
      ids.add(checked.receipt_id);
      receipts.push(checked);
    }
    return Object.freeze(receipts);
  }
}
