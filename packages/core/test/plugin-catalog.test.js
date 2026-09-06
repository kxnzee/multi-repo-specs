/** @fileoverview Проверки универсального доменного каталога Plugins. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PluginCatalog,
  PluginCatalogEntry,
  PluginSource,
} from "@openspec-orch/core";

/** Создаёт одну запись каталога без filesystem discovery. */
function entry(id, name = id) {
  return new PluginCatalogEntry({
    id,
    name,
    source: PluginSource.parse(`@test/plugin-${id}@1.0.0`),
  });
}

test("PluginCatalog keeps stable order and selects only known Plugins", () => {
  const catalog = new PluginCatalog([entry("zeta", "Zeta"), entry("alpha", "Alpha")]);

  assert.deepEqual(catalog.entries.map(({ id }) => id), ["alpha", "zeta"]);
  assert.deepEqual(catalog.select(["zeta", "alpha"]).map(({ id }) => id), ["alpha", "zeta"]);
  assert.equal(catalog.require("alpha").name, "Alpha");
  assert.equal(Object.isFrozen(catalog.entries), true);
  assert.throws(() => catalog.require("missing"), /PLUGIN_NOT_DISCOVERED/);
});

test("PluginCatalog exposes an optional recommendation marker", () => {
  const optional = entry("optional");
  const recommended = new PluginCatalogEntry({
    id: "recommended",
    name: "Recommended",
    recommended: true,
    source: PluginSource.parse("@test/plugin-recommended@1.0.0"),
  });

  assert.equal(optional.recommended, false);
  assert.equal(recommended.recommended, true);
  assert.throws(
    () => new PluginCatalogEntry({
      id: "invalid",
      name: "Invalid",
      recommended: "yes",
      source: PluginSource.parse("@test/plugin-invalid@1.0.0"),
    }),
    /recommended.*boolean/,
  );
});

test("PluginCatalog rejects invalid and duplicate entries", () => {
  assert.throws(() => new PluginCatalog([entry("sample"), entry("sample")]), /повторяющийся/);
  assert.throws(() => new PluginCatalog([{}]), /PluginCatalogEntry/);
  assert.throws(() => new PluginCatalogEntry({ id: "../sample" }), /PLUGIN_CATALOG_INVALID/);
  assert.throws(
    () => new PluginCatalog([entry("sample")]).select(["sample", "sample"]),
    /повторяющийся/,
  );
});
