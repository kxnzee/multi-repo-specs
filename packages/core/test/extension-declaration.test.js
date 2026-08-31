/** @fileoverview Переносимая декларация standalone Extension в Store config. */

import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionDeclaration } from "@openspec-orch/core";

test("ExtensionDeclaration keeps only ID and matching bundled source", () => {
  const declaration = new ExtensionDeclaration({
    id: "spec-driven-extended",
    source: "bundled:spec-driven-extended",
  });

  assert.equal(declaration.id, "spec-driven-extended");
  assert.equal(declaration.source, "bundled:spec-driven-extended");
  assert.deepEqual(declaration.toConfig(), {
    id: "spec-driven-extended",
    source: "bundled:spec-driven-extended",
  });
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.toConfig()), true);
});

test("ExtensionDeclaration rejects version, revision and mismatched identity", () => {
  assert.throws(
    () => new ExtensionDeclaration({ id: "spec-driven-extended", source: "bundled:superpowers" }),
    /EXTENSION_DECLARATION_INVALID/,
  );
  assert.throws(
    () => new ExtensionDeclaration({
      id: "spec-driven-extended",
      source: "bundled:spec-driven-extended@1.0.0",
    }),
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
