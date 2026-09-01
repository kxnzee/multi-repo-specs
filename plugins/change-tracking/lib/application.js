/** @fileoverview Shared task-to-revision application API for CLI and MCP. */

import { AttemptTrackingService } from "./attempt-service.js";

/** Transport-neutral facade over the only Change Tracking workflow. */
export class ChangeTrackingApplication {
  #service;

  constructor(context, { service = new AttemptTrackingService(context) } = {}) {
    this.#service = service;
    Object.freeze(this);
  }

  startAttempt({ changeId, taskId }) {
    return this.#service.start({ changeId, taskId });
  }

  completeAttempt({ changeId, taskId }) {
    return this.#service.complete({ changeId, taskId });
  }

  getStatus(changeId) {
    return this.#service.status(changeId);
  }
}
