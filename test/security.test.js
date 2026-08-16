/** @fileoverview Проверки защиты управляемых конфигураций от symlink. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { initProject } from "../src/internal/init/index.js";
import { readRelativeRegularFile } from "../src/internal/shared/files.js";
import { parseTemplateDescriptor } from "../src/internal/template/index.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

const BASE_TEMPLATE_DESCRIPTOR = parseTemplateDescriptor(
  await fs.readFile(new URL("../templates/base/template.yaml", import.meta.url), "utf8"),
);
const DEFAULT_AGENT_ID = Object.keys(BASE_TEMPLATE_DESCRIPTOR.agents).sort()[0];

test("readRelativeRegularFile blocks a symlink in a parent directory", async (t) => {
  const directory = await temporaryDirectory(t, "openspec-orchestrator-security-");
  const external = await temporaryDirectory(t, "openspec-orchestrator-security-");
  await fs.writeFile(path.join(external, "handoff.md"), "external\n", "utf8");
  await fs.symlink(external, path.join(directory, "workflow"));

  await assert.rejects(
    readRelativeRegularFile(directory, "workflow/handoff.md"),
    /содержит symlink/,
  );
});

test("initProject blocks a Store metadata symlink", async (t) => {
  const directory = await temporaryDirectory(t, "openspec-orchestrator-security-");
  const metadataDirectory = path.join(directory, ".openspec-store");
  const external = path.join(directory, "external-store.yaml");
  await fs.mkdir(metadataDirectory);
  await fs.writeFile(external, "version: 1\nid: payments-specs\n");
  await fs.symlink(external, path.join(metadataDirectory, "store.yaml"));

  await assert.rejects(
    initProject({ target: directory, storeId: "payments-specs", agentId: DEFAULT_AGENT_ID }),
  );
  assert.equal(await fs.readFile(external, "utf8"), "version: 1\nid: payments-specs\n");
});
