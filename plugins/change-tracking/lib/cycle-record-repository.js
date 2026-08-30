/** @fileoverview Cycle Record persistence through the public repository Files facade. */

import { parse, stringify } from "yaml";

import { CHANGE_TRACKING_CONTRACT } from "./contracts.js";
import { CycleRecord } from "./cycle-record.js";

/** Repository for Git-tracked Cycle Records inside the Store checkout. */
export class CycleRecordRepository {
  #files;

  /** @param {{listFiles: Function, read: Function, write: Function}} files Public Files facade. */
  constructor(files) {
    if (
      !files || typeof files.listDirectories !== "function" ||
      typeof files.read !== "function" || typeof files.write !== "function"
    ) {
      throw new Error("CHANGE_TRACKING_INVALID: требуется Files facade");
    }
    this.#files = files;
    Object.freeze(this);
  }

  /** @returns {string} Stable Store-relative POSIX path for a Change ID. */
  pathFor(changeId) {
    return `${CHANGE_TRACKING_CONTRACT.trackingDirectory}/${changeId}/cycle.yaml`;
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
      document = parse(source);
    } catch (error) {
      throw new Error(`STATE_CORRUPTED: Cycle Record повреждён (${relativePath}): ${error.message}`);
    }
    return new CycleRecord(document, { expectedChangeId: changeId });
  }

  /** Lists every validated Cycle Record stored at the normative tracked path. */
  async list() {
    const changeIds = await this.#files.listDirectories(
      CHANGE_TRACKING_CONTRACT.trackingDirectory,
      { optional: true },
    );
    const records = [];
    for (const changeId of changeIds) {
      const record = await this.read(changeId);
      if (record === null) {
        throw new Error(`STATE_CORRUPTED: отсутствует Cycle Record для ${changeId}`);
      }
      records.push(record);
    }
    return Object.freeze(records);
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
    await this.#files.write(relativePath, stringify(record.toDocument()));
    return relativePath;
  }
}
