/** @fileoverview Общий fixture для distribution-проверок Change Tracking. */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_PATH, runCli, commitAll, distributionFixture } from "./distribution.js";

/** Готовит зафиксированные Tasks и pointer без аккаунтов Git hosting. */
export async function prepareTracking(t, customSchema = false) {
  const fixture = await distributionFixture(t, "openspec-tracking-simple-");
  const { storeRoot, codeRoot } = fixture;
  if (customSchema) {
    await fs.cp(new URL("../plugins/change-tracking/fixtures/schema/", import.meta.url),
      path.join(storeRoot, "openspec/schemas/tracking-fixture"), { recursive: true });
  }
  await execa("openspec", ["new", "change", "tracking", "--schema", customSchema ? "tracking-fixture" : "spec-driven"], { cwd: storeRoot });
  const tasksPath = path.join(storeRoot, `openspec/changes/tracking/${customSchema ? "work" : "tasks"}.md`);
  await fs.writeFile(tasksPath, "- [ ] Implement field\n- [ ] Review field\n");
  await commitAll(storeRoot, "Plan tracking");
  await fs.mkdir(path.join(codeRoot, "openspec"), { recursive: true });
  await fs.writeFile(path.join(codeRoot, "openspec/config.yaml"), "store: specs\n");
  await commitAll(codeRoot, "Connect Store");
  const command = ["plugin", "exec", "--repo", "specs", "change-tracking"];
  return { ...fixture, tasksPath, command,
    mapPath: path.join(storeRoot, "openspec/changes/tracking/implementation-map.yaml") };
}

/** Запускает MCP в фиксированном checkout и закрывает его перед удалением fixture. */
export async function trackingClientFor(fixture, cwd) {
  const client = new Client({ name: "tracking-smoke", version: "1.0.0" });
  fixture.registerCleanup(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_PATH], cwd,
    env: { ...process.env }, stderr: "pipe" }));
  return client;
}

/** Устанавливает только plugin bindings локального тестового Store. */
export async function connectTracking(fixture) {
  await runCli(fixture.storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(fixture.storeRoot, "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend");
  await commitAll(fixture.storeRoot, "Plugin configuration");
}
