/** @fileoverview Cycle Record persistence through the public repository Files facade. */

import { Buffer } from "node:buffer";

import { CHANGE_TRACKING_CONTRACT } from "./contracts.js";
import { CycleRecord } from "./cycle-record.js";

/** Encodes a Change ID into the stable base64url Cycle Record key. */
function encodeChangeKey(changeId) {
  if (typeof changeId !== "string" || changeId.length === 0) {
    throw new Error("CHANGE_TRACKING_INVALID: changeId обязателен");
  }
  return Buffer.from(changeId, "utf8").toString("base64url");
}

/** Repository for Git-tracked Cycle Records inside the Store checkout. */
export class CycleRecordRepository {
  #files;

  /** @param {{read: Function, write: Function}} files Public PluginContext Files facade. */
  constructor(files) {
    if (!files || typeof files.read !== "function" || typeof files.write !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: требуется Files facade");
    }
    this.#files = files;
    Object.freeze(this);
  }

  /** @returns {string} Stable Store-relative POSIX path for a Change ID. */
  pathFor(changeId) {
    return `${CHANGE_TRACKING_CONTRACT.cycleRecordsDirectory}/${encodeChangeKey(changeId)}.json`;
  }

  /**
   * Reads one Cycle Record. Absence is a valid empty result.
   *
   * @param {string} changeId Expected Change ID.
   * @returns {Promise<CycleRecord | null>} Persisted record or null.
   */
  async read(changeId) {
    const relativePath = this.pathFor(changeId);
    const source = await this.#files.read(relativePath, { optional: true });
    if (source === null) return null;
    let document;
    try {
      document = JSON.parse(source);
    } catch (error) {
      throw new Error(`STATE_CORRUPTED: Cycle Record повреждён (${relativePath}): ${error.message}`);
    }
    return new CycleRecord(document, { expectedChangeId: changeId });
  }

  /**
   * Atomically writes one validated Cycle Record without committing it.
   *
   * @param {CycleRecord} record Domain record.
   * @returns {Promise<string>} Written Store-relative path.
   */
  async write(record) {
    if (!(record instanceof CycleRecord)) {
      throw new Error("CHANGE_TRACKING_INVALID: требуется CycleRecord");
    }
    const relativePath = this.pathFor(record.changeId);
    await this.#files.write(
      relativePath,
      `${JSON.stringify(record.toDocument(), null, 2)}\n`,
    );
    return relativePath;
  }
}
