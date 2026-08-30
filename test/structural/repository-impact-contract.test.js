/** @fileoverview Cross-Plugin guard for the shared Repository Impact grammar. */

import assert from "node:assert/strict";
import test from "node:test";

import { parseRepositoryImpactRepositories } from "../../plugins/change-tracking/lib/repository-impact.js";
import { parseRepositoryImpact } from "../../plugins/openspec-graph/lib/compiler-input.js";

const CHANGE_ID = "checkout-flow";

/** Returns the ordered unique repository scope produced by OpenSpec Graph. */
function graphRepositories(source) {
  const result = parseRepositoryImpact(source, "openspec/changes/checkout-flow/proposal.md", CHANGE_ID);
  assert.equal(result.present, true);
  assert.deepEqual(result.diagnostics, []);
  return [...new Set(result.entries.map(({ repositoryId }) => repositoryId))];
}

test("Change Tracking and OpenSpec Graph accept the same Repository Impact table grammar", () => {
  for (const source of [
    [
      "## Repository Impact",
      "",
      "| Repository | Capabilities |",
      "| --- | :---: |",
      "| `frontend` | `checkout/ui`, `checkout/cart` |",
      "| backend | checkout/api |",
      "",
    ].join("\n"),
    [
      "# Proposal",
      "",
      "## Repository Impact",
      "| Repository | Capabilities |",
      "|---|---|",
      "| frontend | checkout/ui |",
      "| frontend | checkout/cart |",
      "",
      "## Risks",
    ].join("\n"),
  ]) {
    assert.deepEqual(
      parseRepositoryImpactRepositories(source, CHANGE_ID),
      graphRepositories(source),
    );
  }
});

test("Change Tracking and OpenSpec Graph reject duplicated mappings", () => {
  const source = [
    "## Repository Impact",
    "",
    "| Repository | Capabilities |",
    "| --- | --- |",
    "| frontend | checkout/ui |",
    "| frontend | checkout/ui |",
    "",
  ].join("\n");

  assert.throws(
    () => parseRepositoryImpactRepositories(source, CHANGE_ID),
    /повторяется mapping/u,
  );
  assert.match(
    parseRepositoryImpact(source, "proposal.md", CHANGE_ID)
      .diagnostics.map(({ code }) => code).join(" "),
    /REPOSITORY_IMPACT_DUPLICATE_MAPPING/u,
  );
});
