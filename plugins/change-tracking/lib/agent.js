/** @fileoverview Change Tracking implementation of governed MCP operations and read overlays. */
import { ChangeTrackingApplication } from "./application.js";

/** Preserves the Plugin's unavailable-capability diagnostic for direct operations. */
function requireApplication(application) {
  if (application) return application;
  throw new Error("CAPABILITY_UNAVAILABLE: change-tracking is not initialized; inspect Doctor");
}

export const changeTrackingAgentContribution = Object.freeze({
  create: (context) => new ChangeTrackingApplication(context),
  operations: Object.freeze({
    start_attempt: (application, { change_id: changeId, task_id: taskId }) => (
      requireApplication(application).startAttempt({ changeId, taskId })
    ),
    complete_attempt: (application, { change_id: changeId, task_id: taskId }) => (
      requireApplication(application).completeAttempt({ changeId, taskId })
    ),
  }),
  async enhance({ application, operation, input, result }) {
    if (operation !== "getStatus" && operation !== "getChangeContext") return result;
    return Object.freeze({
      ...result,
      ...(operation === "getStatus" ? {
        capabilities: Object.freeze({
          ...result.capabilities,
          tracking: Object.freeze({
            provider: "change-tracking",
            available: application !== null,
            ...(application === null ? {
              reason: "Plugin is not initialized or unavailable; inspect Doctor",
            } : {}),
          }),
        }),
      } : {}),
      tracking: application && input.change_id ? await application.getStatus(input.change_id) : null,
    });
  },
});
