/** @fileoverview Regression coverage for Core runtime pins under different npm layouts. */

import assert from "node:assert/strict";
import test from "node:test";

import { assertRuntimeDependencyPins, lockedDependencyClosure } from "../test-support/runtime-dependency-pins.js";

const CORE = "src/packages/core";
const PROMPTS = "@inquirer/prompts";

/** Models OpenSpec's hoisted prompts and Core's separate prompts/runtime dependency tree. */
function nestedFixture() {
  return {
    manifest: { dependencies: { [PROMPTS]: "7.10.1", "wrap-ansi": "6.2.0", "strip-ansi": "6.0.1" } },
    lock: { packages: {
      [CORE]: { version: "0.1.0", dependencies: { [PROMPTS]: "7.10.1" } },
      "node_modules/@inquirer/prompts": { version: "8.7.2", dependencies: { "@inquirer/core": "^11.0.0" } },
      "node_modules/@inquirer/core": { version: "11.0.0", dependencies: { "fast-wrap-ansi": "^0.2.0" } },
      "node_modules/fast-wrap-ansi": { version: "0.2.2" },
      "node_modules/wrap-ansi": { version: "9.0.0" },
      "node_modules/strip-ansi": { version: "7.1.0" },
      [`${CORE}/node_modules/@inquirer/prompts`]: { version: "7.10.1", dependencies: { "@inquirer/core": "^10.3.2" } },
      [`${CORE}/node_modules/@inquirer/core`]: { version: "10.3.2", dependencies: { "wrap-ansi": "^6.2.0" } },
      [`${CORE}/node_modules/@inquirer/core/node_modules/wrap-ansi`]: { version: "6.2.0", dependencies: { "strip-ansi": "^6.0.0" } },
      [`${CORE}/node_modules/strip-ansi`]: { version: "6.0.1" },
    } },
  };
}

test("Core pins use nested prompts 7.10.1 and its nested dependencies instead of OpenSpec prompts 8.7.2", () => {
  const { manifest, lock } = nestedFixture();
  assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS);
  assert.deepEqual(
    lockedDependencyClosure(lock, CORE, PROMPTS).map(({ name, entry }) => [name, entry.version]),
    [[PROMPTS, "7.10.1"], ["@inquirer/core", "10.3.2"], ["wrap-ansi", "6.2.0"], ["strip-ansi", "6.0.1"]],
  );
});

test("Core pins still accept a fully hoisted runtime", () => {
  const { manifest } = nestedFixture();
  const lock = { packages: {
    "node_modules/@inquirer/prompts": { version: "7.10.1", dependencies: { "@inquirer/core": "^10.3.2" } },
    "node_modules/@inquirer/core": { version: "10.3.2", dependencies: { "wrap-ansi": "^6.2.0" } },
    "node_modules/wrap-ansi": { version: "6.2.0", dependencies: { "strip-ansi": "^6.0.0" } },
    "node_modules/strip-ansi": { version: "6.0.1" },
  } };
  assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS);
});

test("Core pins still reject a missing or mismatched external pin", () => {
  for (const pin of [undefined, "9.0.0"]) {
    const { manifest, lock } = nestedFixture();
    if (pin === undefined) delete manifest.dependencies["wrap-ansi"];
    else manifest.dependencies["wrap-ansi"] = pin;
    assert.throws(() => assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS), /wrap-ansi@6\.2\.0/u);
  }
});

test("Core pins reject a root dependency resolved to a different version", () => {
  const { manifest, lock } = nestedFixture();
  manifest.dependencies[PROMPTS] = "8.7.2";
  assert.throws(() => assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS), /Core must pin @inquirer\/prompts/u);
});

test("Core closure rejects a missing required lock entry", () => {
  const { manifest, lock } = nestedFixture();
  delete lock.packages[`${CORE}/node_modules/strip-ansi`];
  delete lock.packages["node_modules/strip-ansi"];
  assert.throws(() => assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS), /Missing lock entry for strip-ansi/u);
});

test("Core closure follows a workspace link before resolving dependencies", () => {
  const { manifest, lock } = nestedFixture();
  const prompts = lock.packages[`${CORE}/node_modules/@inquirer/prompts`];
  lock.packages[`${CORE}/node_modules/@inquirer/prompts`] = { link: true, resolved: "packages/prompts" };
  lock.packages["packages/prompts"] = prompts;
  lock.packages["packages/prompts/node_modules/@inquirer/core"] = lock.packages[`${CORE}/node_modules/@inquirer/core`];
  lock.packages["packages/prompts/node_modules/wrap-ansi"] = lock.packages[`${CORE}/node_modules/@inquirer/core/node_modules/wrap-ansi`];
  lock.packages["packages/prompts/node_modules/strip-ansi"] = lock.packages[`${CORE}/node_modules/strip-ansi`];
  assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS);
});

test("Core closure visits package locations independently and terminates dependency cycles", () => {
  const { manifest, lock } = nestedFixture();
  lock.packages[`${CORE}/node_modules/@inquirer/prompts`].dependencies["strip-ansi"] = "^6.0.0";
  lock.packages[`${CORE}/node_modules/@inquirer/core`].dependencies["strip-ansi"] = "^6.0.0";
  lock.packages[`${CORE}/node_modules/@inquirer/core/node_modules/strip-ansi`] = {
    version: "6.0.0", dependencies: { "@inquirer/core": "^10.3.2" },
  };
  const versions = lockedDependencyClosure(lock, CORE, PROMPTS)
    .filter(({ name }) => name === "strip-ansi").map(({ entry }) => entry.version).sort();
  assert.deepEqual(versions, ["6.0.0", "6.0.1"]);
  assert.throws(() => assertRuntimeDependencyPins(manifest, lock, CORE, PROMPTS), /strip-ansi@6\.0\.0/u);
});
