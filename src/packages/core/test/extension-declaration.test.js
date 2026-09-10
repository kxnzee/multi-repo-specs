/** @fileoverview Переносимая декларация standalone Extension в Store config. */

import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionDeclaration } from "@openspec-orch/core";

test("ExtensionDeclaration keeps only a stable ID", () => {
  const declaration = new ExtensionDeclaration("spec-driven-extended");

  assert.equal(declaration.id, "spec-driven-extended");
  assert.deepEqual(declaration.toConfig(), "spec-driven-extended");
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.toConfig()), true);
});

test("ExtensionDeclaration rejects object declarations and invalid IDs", () => {
  assert.throws(
    () => new ExtensionDeclaration({ id: "spec-driven-extended", source: "bundled:spec-driven-extended" }),
    /EXTENSION_DECLARATION_INVALID/,
  );
  assert.throws(
    () => new ExtensionDeclaration("SpecDrivenExtended"),
    /EXTENSION_DECLARATION_INVALID/,
  );
  assert.throws(
    () => new ExtensionDeclaration({
      id: "spec-driven-extended",
      source: "bundled:spec-driven-extended",
      version: "1.0.0",
    }),
    /EXTENSION_DECLARATION_INVALID/,
  );
});
