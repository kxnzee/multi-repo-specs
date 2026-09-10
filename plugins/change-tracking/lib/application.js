/** @fileoverview Shared task-to-revision application API for CLI and MCP. */

import { ImplementationMapRepository } from "./implementation-map-repository.js";
import { ImplementationTrackingService } from "./implementation-service.js";
import { AttemptTrackingService } from "./attempt-service.js";

/** Общий API карты реализации и локальных attempts для CLI/MCP. */
export class ChangeTrackingApplication {
  #service;
  #implementation;
  #maps;

  constructor(context, { service = new AttemptTrackingService(context) } = {}) {
    this.#service = service;
    this.#maps = new ImplementationMapRepository(context.files);
    this.#implementation = new ImplementationTrackingService(context);
    Object.freeze(this);
  }

  startAttempt({ changeId, taskId }) {
    return this.#service.start({ changeId, taskId });
  }

  completeAttempt({ changeId, taskId }) {
    return this.#service.complete({ changeId, taskId });
  }

  cancelAttempt(args) {
    return this.#service.cancel(args);
  }

  recordImplementation(input) {
    return this.#implementation.record(input);
  }

  async getStatus(changeId) {
    let legacy;
    try {
      legacy = await this.#service.status(changeId);
    } catch (error) {
      if (!error.message?.startsWith("PLUGIN_STORAGE_CORRUPTED:")) throw error;
      legacy = { change_id: changeId, path: this.#maps.pathFor(changeId),
        active: null, cancelled: null, completed: await this.#maps.read(changeId),
        legacy_error: { code: "PLUGIN_STORAGE_CORRUPTED", message: error.message } };
    }
    return { ...legacy, ...await this.#implementation.overview(changeId, legacy.completed) };
  }
}
