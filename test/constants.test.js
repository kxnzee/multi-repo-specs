/** @fileoverview Контракт статических версий, regex и служебных путей Core. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CONTRACT_PATTERNS,
  CONTRACT_VERSIONS,
  DESCRIPTOR_FILES,
  IDENTIFIER_PREFIXES,
  SERVICE_PATHS,
} from "../src/internal/config/constants.js";

test("static contract constants are immutable and internally consistent", () => {
  for (const constants of [
    CONTRACT_PATTERNS,
    CONTRACT_VERSIONS,
    DESCRIPTOR_FILES,
    IDENTIFIER_PREFIXES,
    SERVICE_PATHS,
  ]) {
    assert.equal(Object.isFrozen(constants), true);
  }
  for (const version of Object.values(CONTRACT_VERSIONS)) {
    assert.equal(Number.isInteger(version) && version > 0, true);
  }
  for (const pattern of Object.values(CONTRACT_PATTERNS)) {
    assert.equal(pattern instanceof RegExp, true);
    assert.equal(pattern.global || pattern.sticky, false);
  }
  for (const relativePath of Object.values(SERVICE_PATHS)) {
    assert.equal(typeof relativePath === "string" && relativePath.length > 0, true);
    assert.equal(path.isAbsolute(relativePath), false);
  }
  assert.equal(CONTRACT_PATTERNS.id.test("dependency-audit"), true);
  assert.equal(CONTRACT_PATTERNS.gitRevision.test("a".repeat(40)), true);
  assert.equal(
    CONTRACT_PATTERNS.snapshotId.test(`${IDENTIFIER_PREFIXES.snapshot}${"a".repeat(64)}`),
    true,
  );
  assert.equal(path.basename(DESCRIPTOR_FILES.plugin), DESCRIPTOR_FILES.plugin);
  assert.equal(path.basename(DESCRIPTOR_FILES.template), DESCRIPTOR_FILES.template);
});
