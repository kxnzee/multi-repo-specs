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

const DEFAULT_TEMPLATE_ROOT = fileURLToPath(new URL("../../../../templates/default/", import.meta.url));
const INITIATIVE_TEMPLATE_ROOT = fileURLToPath(new URL("../../../../templates/initiative/", import.meta.url));

test("bundled Template provider discovers checked packages by stable ID", async () => {
  const [defaultTemplate, initiativeTemplate] = await Promise.all([
    BundledTemplatePackage.load(DEFAULT_TEMPLATE_ROOT, { expectedId: "default" }),
    BundledTemplatePackage.load(INITIATIVE_TEMPLATE_ROOT, { expectedId: "initiative" }),
  ]);
  const provider = new BundledTemplateProvider([initiativeTemplate, defaultTemplate]);

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
      requiredExtensions: ["project-context", "spec-driven-extended", "superpowers"],
    },
    {
      id: "initiative",
      name: "Initiative planning",
      requiredExtensions: ["initiative", "project-context"],
    },
  ]);
  assert.equal(provider.resolve("default").root, await fs.realpath(DEFAULT_TEMPLATE_ROOT));
  assert.deepEqual(
    provider.catalog.requiredExtensionsFor("default"),
    ["project-context", "spec-driven-extended", "superpowers"],
  );
  assert.deepEqual(
    provider.catalog.requiredExtensionsFor("initiative"),
    ["initiative", "project-context"],
  );
  assert.throws(
    () => provider.resolve("unknown"),
    /TEMPLATE_NOT_DISCOVERED: template-id 'unknown' не найден/u,
  );
  assert.throws(
    () => new BundledTemplateProvider([defaultTemplate], { defaultId: "unknown" }),
    /BUNDLED_TEMPLATE_INVALID: defaultId 'unknown' не входит/u,
  );
});
