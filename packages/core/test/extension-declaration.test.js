/** @fileoverview Переносимая декларация standalone Extension в Store config. */

import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionDeclaration } from "@openspec-orch/core";

test("ExtensionDeclaration keeps only ID and matching bundled source", () => {
  const declaration = new ExtensionDeclaration({
    id: "openspec-base",
    source: "bundled:openspec-base",
  });

  assert.equal(declaration.id, "openspec-base");
  assert.equal(declaration.source, "bundled:openspec-base");
  assert.deepEqual(declaration.toConfig(), {
    id: "openspec-base",
    source: "bundled:openspec-base",
  });
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.toConfig()), true);
});

test("ExtensionDeclaration rejects version, revision and mismatched identity", () => {
  assert.throws(
    () => new ExtensionDeclaration({ id: "openspec-base", source: "bundled:superpowers" }),
    /EXTENSION_DECLARATION_INVALID/,
  );
  assert.throws(
    () => new ExtensionDeclaration({
      id: "openspec-base",
      source: "bundled:openspec-base@1.0.0",
    }),
    /EXTENSION_DECLARATION_INVALID/,
  );
  assert.throws(
    () => new ExtensionDeclaration({
      id: "openspec-base",
      source: "bundled:openspec-base",
      version: "1.0.0",
    }),
    /EXTENSION_DECLARATION_INVALID/,
  );
});
