/** @fileoverview Public contract bundled Project Template packages. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundledTemplatePackage,
  BundledTemplateProvider,
  isBundledTemplateProvider,
} from "@openspec-orch/core";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../../templates/default/", import.meta.url));

test("bundled Template provider discovers checked packages by stable ID", async () => {
  const templatePackage = await BundledTemplatePackage.load(TEMPLATE_ROOT, {
    expectedId: "default",
  });
  const provider = new BundledTemplateProvider([templatePackage]);

  assert.equal(isBundledTemplateProvider(provider), true);
  assert.equal(isBundledTemplateProvider({ catalog: { entries: [] } }), false);
  assert.equal(provider.defaultId, "default");
  assert.deepEqual(provider.catalog.entries.map(({ id, name, requiredExtensions }) => ({
    id,
    name,
    requiredExtensions,
  })), [
    {
      id: "default",
      name: "Default Project Template",
      requiredExtensions: ["openspec-base", "superpowers"],
    },
  ]);
  assert.equal(provider.resolve("default").root, await fs.realpath(TEMPLATE_ROOT));
  assert.deepEqual(
    provider.catalog.requiredExtensionsFor("default"),
    ["openspec-base", "superpowers"],
  );
  assert.throws(
    () => provider.resolve("unknown"),
    /TEMPLATE_NOT_DISCOVERED: template-id 'unknown' не найден/u,
  );
  assert.throws(
    () => new BundledTemplateProvider([templatePackage], { defaultId: "unknown" }),
    /BUNDLED_TEMPLATE_INVALID: defaultId 'unknown' не входит/u,
  );
});
