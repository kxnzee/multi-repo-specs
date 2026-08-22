/** @fileoverview Контракт единой точки эксплуатационных настроек Core. */

import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_SETTINGS } from "../src/internal/config/settings.js";

/** Проверяет рекурсивную неизменяемость объекта настроек. */
function assertDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") assertDeepFrozen(nested);
  }
}

test("project settings are immutable and contain valid project defaults", () => {
  assertDeepFrozen(PROJECT_SETTINGS);
  assert.equal(typeof PROJECT_SETTINGS.execution.strictByDefault, "boolean");
  assert.equal(
    Number.isFinite(PROJECT_SETTINGS.execution.externalCommandTimeoutMs) &&
      PROJECT_SETTINGS.execution.externalCommandTimeoutMs > 0,
    true,
  );
  assert.match(PROJECT_SETTINGS.workspace.repositoriesDirectory, /^[A-Za-z0-9._-]+$/);
  assert.equal(Number.isInteger(PROJECT_SETTINGS.plugins.processConcurrency), true);
  assert.equal(PROJECT_SETTINGS.plugins.processConcurrency > 0, true);
  assert.equal(typeof PROJECT_SETTINGS.openSpec.init.profile, "string");
  assert.equal(typeof PROJECT_SETTINGS.openSpec.init.delivery, "string");
  assert.equal(PROJECT_SETTINGS.openSpec.init.workflows.length > 0, true);
  assert.equal(
    new Set(PROJECT_SETTINGS.openSpec.init.workflows).size,
    PROJECT_SETTINGS.openSpec.init.workflows.length,
  );
});
