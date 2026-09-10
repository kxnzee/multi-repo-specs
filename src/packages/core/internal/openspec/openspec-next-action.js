/** @fileoverview Консервативная интерпретация artifact graph OpenSpec. */

/** Checks only schema-declared prerequisites for the built-in Apply action. */
function applyPrerequisitesComplete(status, artifacts) {
  const applyRequires = Array.isArray(status.applyRequires) ? new Set(status.applyRequires) : null;
  return status.isPlanningComplete === true || (
    applyRequires && [...applyRequires].every((id) => artifacts.some((artifact) => (
      artifact.id === id && ["done", "skipped"].includes(artifact.status)
    )))
  );
}

/** Interprets schema-aware Apply progress without reading task files in Core. */
function applyProgressState(instructions) {
  const progress = instructions?.progress;
  if (
    !progress || typeof progress !== "object" || Array.isArray(progress) ||
    ![progress.total, progress.complete, progress.remaining].every(Number.isInteger) ||
    progress.total <= 0 || progress.complete < 0 || progress.remaining < 0 ||
    progress.complete + progress.remaining !== progress.total
  ) return "unknown";
  if (instructions.state === "ready" && progress.remaining > 0) return "pending";
  if (instructions.state === "all_done" && progress.remaining === 0) return "complete";
  return "unknown";
}

/** Derives only a safe next action from the stable OpenSpec artifact vocabulary. */
export function nextOpenSpecAction(status, changeId, applyInstructions) {
  if (!Array.isArray(status.artifacts)) {
    return Object.freeze({
      action: "consult_change_context", actor: "agent",
      reason: "OpenSpec status не содержит artifact graph для автоматической маршрутизации",
      change_id: changeId,
    });
  }
  const artifacts = status.artifacts.filter((artifact) => (
    artifact && typeof artifact === "object" && !Array.isArray(artifact) &&
    typeof artifact.id === "string" && typeof artifact.status === "string"
  ));
  if (artifacts.length !== status.artifacts.length) {
    return Object.freeze({
      action: "consult_change_context", actor: "agent",
      reason: "OpenSpec status содержит несовместимый artifact graph", change_id: changeId,
    });
  }
  const ready = artifacts.filter(({ status: value }) => value === "ready");
  const planningComplete = applyPrerequisitesComplete(status, artifacts);
  const progressState = planningComplete && applyInstructions !== undefined
    ? applyProgressState(applyInstructions)
    : undefined;
  if (progressState === "pending") {
    return Object.freeze({
      action: "apply_change", actor: "agent",
      reason: "OpenSpec сообщил о незавершённых Apply tasks", change_id: changeId,
    });
  }
  if (progressState === "unknown") {
    return Object.freeze({
      action: "consult_change_context", actor: "agent",
      reason: "OpenSpec не сообщил однозначный прогресс Apply", change_id: changeId,
    });
  }
  if (ready.length === 1) {
    return Object.freeze({
      action: "prepare_artifact", actor: "agent",
      reason: "OpenSpec разблокировал следующий artifact", change_id: changeId, artifact: ready[0].id,
    });
  }
  if (ready.length > 1) {
    return Object.freeze({
      action: "choose_ready_artifact", actor: "human",
      reason: "OpenSpec допускает несколько следующих artifacts; выбор не должен быть угадан",
      change_id: changeId, artifacts: Object.freeze(ready.map(({ id }) => id)),
    });
  }
  const blocked = artifacts.filter(({ status: value }) => value === "blocked");
  if (blocked.length > 0) {
    return Object.freeze({
      action: "resolve_artifact_blocker", actor: "human",
      reason: "OpenSpec artifact graph содержит заблокированные artifacts",
      change_id: changeId, artifacts: Object.freeze(blocked.map(({ id }) => id)),
    });
  }
  if (progressState === "complete") {
    return Object.freeze({
      action: "no_automatic_action", actor: "human",
      reason: "OpenSpec Apply завершён и не объявил следующий автоматический artifact", change_id: changeId,
    });
  }
  return Object.freeze({
    action: planningComplete ? "apply_change" : "consult_change_context", actor: "agent",
    reason: planningComplete
      ? "OpenSpec подтвердил готовность Planning prerequisites для Apply"
      : "OpenSpec не объявил однозначный следующий artifact",
    change_id: changeId,
  });
}

/** Tells the facade whether Apply instructions are needed before returning a recommendation. */
export function requiresApplyInstructions(status, candidate) {
  return ["apply_change", "prepare_artifact", "choose_ready_artifact"].includes(candidate.action) &&
    Array.isArray(status.artifacts) && applyPrerequisitesComplete(status, status.artifacts);
}
