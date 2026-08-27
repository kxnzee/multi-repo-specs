/** @fileoverview Contract, configuration and reconciliation tests for MCP Connector. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin, {
  McpConnectorService,
  parseMcpConnectorConfig,
} from "../index.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/** In-memory Core files facade с наблюдаемыми atomic replacements. */
class MemoryFiles {
  #sources;

  constructor(sources = {}) {
    this.#sources = new Map(Object.entries(sources));
  }

  async read(relativePath, { optional = false } = {}) {
    if (this.#sources.has(relativePath)) return this.#sources.get(relativePath);
    if (optional) return null;
    throw new Error(`missing ${relativePath}`);
  }

  async write(relativePath, source) {
    this.#sources.set(relativePath, source);
  }

  source(relativePath) {
    return this.#sources.get(relativePath) ?? null;
  }
}

/** In-memory versioned Plugin storage facade. */
class MemoryStorage {
  #value = null;

  async read() {
    return this.#value === null ? null : JSON.parse(JSON.stringify(this.#value));
  }

  async write(value) {
    this.#value = JSON.parse(JSON.stringify(value));
    return this.#value;
  }

  snapshot() {
    return this.#value === null ? null : JSON.parse(JSON.stringify(this.#value));
  }
}

/** Создаёт минимальный реальный PluginContext-shaped test double. */
function context(agentId, sources = {}) {
  const files = new MemoryFiles(sources);
  const storage = new MemoryStorage();
  return {
    context: Object.freeze({
      agent: Object.freeze({ id: agentId }),
      files,
      storage,
    }),
    files,
    storage,
  };
}

/** Формирует один минимальный versioned Connector config. */
function config(servers) {
  return ["version: 1", "servers:", ...servers.map((line) => `  ${line}`), ""].join("\n");
}

test("Package exposes one agent-only Plugin and root mcp command", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  assert.deepEqual(assertPluginContract({ plugin, packageManifest }), {
    id: "mcp-connector",
    commands: ["mcp"],
  });
  assert.equal(plugin.hasAgentContribution(), true);
  assert.equal(plugin.hasRepositoryContribution(), false);
  assert.equal(plugin.canExec(), true);

  const fixture = context("qwen");
  const integration = plugin.integrateAgent(fixture.context);
  assert.deepEqual(await integration.install(), {
    agentId: "qwen",
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "unconfigured",
    installed: [],
    updated: [],
    removed: [],
    adopted: [],
    unchanged: [],
  });
  assert.equal(fixture.files.source(".qwen/settings.json"), null);
  assert.deepEqual(await integration.remove(), {
    agentId: "qwen",
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "unconfigured",
    removed: [],
  });
});

test("Config is strict, filters Agents and keeps settings opaque", () => {
  const parsed = parseMcpConnectorConfig([
    "version: 1",
    "servers:",
    "  company-search:",
    "    agents: [qwen, claude]",
    "    settings:",
    "      command: company-search-mcp",
    "      args: [--stdio]",
    "    context: Use company-search for internal service discovery.",
    "  internal-docs:",
    "    settings:",
    "      url: http://mcp.internal.example/mcp",
    "",
  ].join("\n"));
  assert.deepEqual(parsed.forAgent("qwen"), {
    "company-search": { command: "company-search-mcp", args: ["--stdio"] },
    "internal-docs": { url: "http://mcp.internal.example/mcp" },
  });
  assert.deepEqual(parsed.forAgent("gigacode"), {
    "internal-docs": { url: "http://mcp.internal.example/mcp" },
  });
  assert.deepEqual(parsed.contextsForAgent("qwen"), {
    "company-search": "Use company-search for internal service discovery.",
  });
  assert.deepEqual(parsed.contextsForAgent("gigacode"), {});

  for (const source of [
    "version: 2\nservers: {}\n",
    "version: 1\nservers: []\n",
    "version: 1\nservers:\n  Bad_ID:\n    settings: {command: mcp}\n",
    "version: 1\nservers:\n  demo:\n    settings: {}\n",
    "version: 1\nservers:\n  demo:\n    unknown: true\n    settings: {command: mcp}\n",
    "version: 1\nservers:\n  demo:\n    context: '  '\n    settings: {command: mcp}\n",
    "version: 1\nservers:\n  demo:\n    context: [invalid]\n    settings: {command: mcp}\n",
    "version: 1\nunknown: true\nservers: {}\n",
  ]) {
    assert.throws(() => parseMcpConnectorConfig(source), /MCP_CONNECTOR_CONFIG_INVALID/);
  }
});

test("Shipped YAML example is a valid configuration template", async () => {
  const example = await fs.readFile(
    path.join(packageRoot, "examples/mcp-connector.yaml"),
    "utf8",
  );
  assert.deepEqual(parseMcpConnectorConfig(example).forAgent("qwen"), {
    "my-mcp": { command: "/path/to/my-mcp", args: ["--stdio"] },
  });
  assert.deepEqual(parseMcpConnectorConfig(example).contextsForAgent("qwen"), {
    "my-mcp": [
      "Используй `my-mcp` только для задач, связанных с внутренней документацией.",
      "Не изменяй данные без явного запроса пользователя.",
    ].join("\n"),
  });
});

test("Apply reconciles only owned entries and remove preserves unrelated settings", async () => {
  const fixture = context("qwen", {
    "mcp-connector.yaml": config([
      "alpha:",
      "  agents: [qwen]",
      "  settings: {command: alpha-mcp, args: [--stdio]}",
      "  context: Use alpha for internal search.",
      "claude-only:",
      "  agents: [claude]",
      "  settings: {command: claude-mcp}",
    ]),
    ".qwen/settings.json": `${JSON.stringify({
      theme: "dark",
      mcpServers: { existing: { command: "existing-mcp" } },
    }, null, 2)}\n`,
    "QWEN.md": "# Existing project instructions\n",
  });
  const service = new McpConnectorService(fixture.context);
  assert.deepEqual(await service.apply(), {
    agentId: "qwen",
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "installed",
    installed: ["alpha"],
    updated: [],
    removed: [],
    adopted: [],
    unchanged: [],
  });
  let settings = JSON.parse(fixture.files.source(".qwen/settings.json"));
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.mcpServers, {
    existing: { command: "existing-mcp" },
    alpha: { command: "alpha-mcp", args: ["--stdio"] },
  });
  assert.match(fixture.files.source("QWEN.md"), /# Existing project instructions/u);
  assert.match(fixture.files.source("QWEN.md"), /### alpha\n\nUse alpha for internal search\./u);
  assert.deepEqual(await service.status(), {
    agentId: "qwen",
    configPath: "mcp-connector.yaml",
    configPresent: true,
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "ready",
    state: "ready",
    servers: [{ id: "alpha", status: "ready" }],
  });

  await fixture.files.write("mcp-connector.yaml", config([
    "beta:",
    "  settings: {url: 'http://mcp.internal.example/mcp'}",
    "  context: Use beta for internal documentation.",
  ]));
  assert.deepEqual(await service.apply(), {
    agentId: "qwen",
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "updated",
    installed: ["beta"],
    updated: [],
    removed: ["alpha"],
    adopted: [],
    unchanged: [],
  });
  settings = JSON.parse(fixture.files.source(".qwen/settings.json"));
  assert.deepEqual(settings.mcpServers, {
    existing: { command: "existing-mcp" },
    beta: { url: "http://mcp.internal.example/mcp" },
  });
  assert.doesNotMatch(fixture.files.source("QWEN.md"), /### alpha/u);
  assert.match(fixture.files.source("QWEN.md"), /### beta/u);

  assert.deepEqual(await service.remove(), {
    agentId: "qwen",
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "removed",
    removed: ["beta"],
  });
  settings = JSON.parse(fixture.files.source(".qwen/settings.json"));
  assert.deepEqual(settings, {
    theme: "dark",
    mcpServers: { existing: { command: "existing-mcp" } },
  });
  assert.equal(fixture.files.source("QWEN.md"), "# Existing project instructions\n");
  assert.deepEqual(fixture.storage.snapshot(), { version: 1, agents: {} });
});

test("Existing foreign entry blocks apply without settings or ownership mutation", async () => {
  const fixture = context("qwen", {
    "mcp-connector.yaml": config([
      "conflict:",
      "  settings: {command: desired-mcp}",
    ]),
    ".qwen/settings.json": `${JSON.stringify({
      mcpServers: { conflict: { command: "foreign-mcp" } },
    }, null, 2)}\n`,
  });
  const original = fixture.files.source(".qwen/settings.json");
  await assert.rejects(
    new McpConnectorService(fixture.context).apply(),
    /MCP_CONNECTOR_ENTRY_CONFLICT/,
  );
  assert.equal(fixture.files.source(".qwen/settings.json"), original);
  assert.equal(fixture.storage.snapshot(), null);
});

test("Manual modification of an owned entry is reported and never overwritten", async () => {
  const fixture = context("qwen", {
    "mcp-connector.yaml": config([
      "managed:",
      "  settings: {command: managed-mcp}",
    ]),
  });
  const service = new McpConnectorService(fixture.context);
  await service.apply();
  await fixture.files.write(".qwen/settings.json", `${JSON.stringify({
    mcpServers: { managed: { command: "manually-modified" } },
  }, null, 2)}\n`);
  assert.deepEqual(await service.status(), {
    agentId: "qwen",
    configPath: "mcp-connector.yaml",
    configPresent: true,
    settingsPath: ".qwen/settings.json",
    instructionsPath: "QWEN.md",
    context: "unconfigured",
    state: "attention",
    servers: [{ id: "managed", status: "modified" }],
  });
  await assert.rejects(service.apply(), /MCP_CONNECTOR_ENTRY_MODIFIED/);
  await assert.rejects(service.remove(), /MCP_CONNECTOR_ENTRY_MODIFIED/);
});

test("Manual modification of managed Agent context is reported and never overwritten", async () => {
  const fixture = context("gigacode", {
    "mcp-connector.yaml": config([
      "managed:",
      "  settings: {command: managed-mcp}",
      "  context: Use managed MCP context.",
    ]),
    "GIGACODE.md": "# Existing instructions\n",
  });
  const service = new McpConnectorService(fixture.context);
  await service.apply();
  await fixture.files.write(
    "GIGACODE.md",
    fixture.files.source("GIGACODE.md").replace(
      "Use managed MCP context.",
      "Manually modified context.",
    ),
  );

  assert.deepEqual(await service.status(), {
    agentId: "gigacode",
    configPath: "mcp-connector.yaml",
    configPresent: true,
    settingsPath: ".gigacode/settings.json",
    instructionsPath: "GIGACODE.md",
    context: "modified",
    state: "attention",
    servers: [{ id: "managed", status: "ready" }],
  });
  await assert.rejects(service.apply(), /MCP_CONNECTOR_CONTEXT_MODIFIED/);
  await assert.rejects(service.remove(), /MCP_CONNECTOR_CONTEXT_MODIFIED/);
});

test("Agent adapters write only their provider-specific settings and instructions paths", async () => {
  for (const [agentId, settingsPath, instructionsPath] of [
    ["claude", ".mcp.json", "CLAUDE.md"],
    ["qwen", ".qwen/settings.json", "QWEN.md"],
    ["gigacode", ".gigacode/settings.json", "GIGACODE.md"],
  ]) {
    const fixture = context(agentId, {
      "mcp-connector.yaml": config([
        "shared:",
        "  settings: {command: shared-mcp}",
        `  context: Use shared MCP from ${agentId}.`,
      ]),
    });
    await new McpConnectorService(fixture.context).apply();
    assert.deepEqual(JSON.parse(fixture.files.source(settingsPath)), {
      mcpServers: { shared: { command: "shared-mcp" } },
    });
    assert.match(
      fixture.files.source(instructionsPath),
      new RegExp(`Use shared MCP from ${agentId}\\.`),
    );
  }
  const unsupported = context("unknown-agent", {
    "mcp-connector.yaml": config([
      "shared:",
      "  settings: {command: shared-mcp}",
    ]),
  });
  await assert.rejects(
    new McpConnectorService(unsupported.context).apply(),
    /MCP_CONNECTOR_AGENT_UNSUPPORTED/,
  );
});
