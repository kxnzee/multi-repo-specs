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

const TEMPLATE_ROOT = fileURLToPath(new URL("../../../templates/base/", import.meta.url));
const SUPERSPEC_TEMPLATE_ROOT = fileURLToPath(
  new URL("../../../templates/superspec/", import.meta.url),
);

test("bundled Template provider discovers checked packages by stable ID", async () => {
  const templatePackage = await BundledTemplatePackage.load(TEMPLATE_ROOT, {
    expectedId: "base",
  });
  const superspecPackage = await BundledTemplatePackage.load(SUPERSPEC_TEMPLATE_ROOT, {
    expectedId: "superspec",
  });
  const provider = new BundledTemplateProvider([superspecPackage, templatePackage]);

  assert.equal(isBundledTemplateProvider(provider), true);
  assert.equal(isBundledTemplateProvider({ catalog: { entries: [] } }), false);
  assert.equal(provider.defaultId, "base");
  assert.deepEqual(provider.catalog.entries.map(({ id, name, requiredExtensions }) => ({
    id,
    name,
    requiredExtensions,
  })), [
    {
      id: "base",
      name: "Base Store Template",
      requiredExtensions: ["openspec-base"],
    },
    {
      id: "superspec",
      name: "Superspec Multi-Repository",
      requiredExtensions: ["superpowers"],
    },
  ]);
  assert.equal(provider.resolve("base").root, await fs.realpath(TEMPLATE_ROOT));
  assert.deepEqual(provider.catalog.requiredExtensionsFor("base"), ["openspec-base"]);
  assert.deepEqual(provider.catalog.requiredExtensionsFor("superspec"), ["superpowers"]);
  assert.deepEqual(provider.resolve("superspec").requiredExtensions, ["superpowers"]);
  assert.throws(
    () => provider.resolve("unknown"),
    /TEMPLATE_NOT_DISCOVERED: template-id 'unknown' не найден/u,
  );
  assert.throws(
    () => new BundledTemplateProvider([templatePackage], { defaultId: "unknown" }),
    /BUNDLED_TEMPLATE_INVALID: defaultId 'unknown' не входит/u,
  );
});
