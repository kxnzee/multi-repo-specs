/** @fileoverview Контракт выбора нескольких standalone Extensions при init. */

import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionCatalog, ExtensionCatalogEntry } from "@openspec-orch/core";

test("ExtensionCatalog validates IDs while preserving explicit selection order", () => {
  const catalog = new ExtensionCatalog([
    new ExtensionCatalogEntry({ id: "alpha", name: "Alpha", source: "bundled:alpha" }),
    new ExtensionCatalogEntry({ id: "beta", name: "Beta", source: "bundled:beta" }),
  ]);

  assert.deepEqual(catalog.select(["beta", "alpha"]).map(({ id }) => id), ["beta", "alpha"]);
  assert.throws(() => catalog.select(["missing"]), /EXTENSION_NOT_DISCOVERED/);
  assert.throws(() => catalog.select(["alpha", "alpha"]), /повторяющийся extension-id/);
});
