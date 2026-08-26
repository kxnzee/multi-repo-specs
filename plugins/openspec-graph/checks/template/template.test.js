/** @fileoverview Independent structural contract of the OpenSpec Graph Plugin Template. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../template/", import.meta.url));

test("OpenSpec Graph Plugin Template declares its assets for every supported Agent", async () => {
  const descriptor = parse(await fs.readFile(path.join(TEMPLATE_ROOT, "template.yaml"), "utf8"));
  const graph = parse(await fs.readFile(path.join(TEMPLATE_ROOT, "openspec/graph.yaml"), "utf8"));
  assert.deepEqual(graph, { version: 1, edges: [] });
  assert.equal(Object.keys(descriptor.agents).length > 0, true);

  for (const [agentId, agent] of Object.entries(descriptor.agents)) {
    assert.deepEqual(Object.keys(agent), ["copy"], agentId);
    assert.equal(Array.isArray(agent.copy), true, agentId);
    assert.equal(
      agent.copy.some(({ from, to }) => from === "openspec/graph.yaml" && to === from),
      true,
      agentId,
    );
    assert.equal(
      agent.copy.some(({ from, to }) => from === "skills" && to.endsWith("/skills")),
      true,
      agentId,
    );
    for (const operation of agent.copy) {
      assert.equal(path.posix.isAbsolute(operation.from), false, agentId);
      assert.equal(path.posix.isAbsolute(operation.to), false, agentId);
      await fs.access(path.join(TEMPLATE_ROOT, operation.from));
    }
  }
});
