/** @fileoverview Проверки generic router и distribution Agent adapters. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundledAgentPackage,
  BundledAgentProvider,
} from "@openspec-orch/core";

const AGENT_ROOT = fileURLToPath(new URL("../../../agents/", import.meta.url));
const agentPackages = await Promise.all(["claude", "gigacode", "qwen"].map((id) => (
  BundledAgentPackage.load(path.join(AGENT_ROOT, id), { expectedId: id })
)));
const agentAdapter = new BundledAgentProvider(agentPackages).adapter;

/** Создаёт Extension payload с manifests всех Agent поставки. */
async function extensionFixture(t, prefix = "openspec-agent-extension-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".claude-plugin"));
  const manifest = `${JSON.stringify({ name: "codegraph-agent" })}\n`;
  await Promise.all([
    fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), manifest),
    fs.writeFile(path.join(root, ".claude-plugin", "marketplace.json"), `${JSON.stringify({
      name: "openspec-orch-codegraph-agent",
      plugins: [{ name: "codegraph-agent", source: "./" }],
    })}\n`),
    fs.writeFile(path.join(root, "qwen-extension.json"), manifest),
    fs.writeFile(path.join(root, "gigacode-extension.json"), manifest),
  ]);
  return root;
}

/** Собирает минимальный scoped Agent context и журнал native calls. */
function invocationContext(agentId, result = "done") {
  const calls = [];
  return {
    calls,
    context: Object.freeze({
      agent: Object.freeze({ id: agentId }),
      process: Object.freeze({
        async run(executable, args) {
          calls.push([executable, args]);
          return typeof result === "function" ? result(calls) : result;
        },
      }),
    }),
  };
}

/** Создаёт runtime Extension target. */
function extension(root, id = "agent") {
  return Object.freeze({
    id,
    root,
    target: Object.freeze({ id: "frontend", role: "code" }),
  });
}

test("AgentExtensionAdapter preflights the selected distribution Agent", async () => {
  const fixture = invocationContext("qwen", "1.0.0");

  assert.equal(await agentAdapter.preflight(fixture.context), "1.0.0");
  assert.deepEqual(fixture.calls, [["qwen", ["--version"]]]);
});

test("Qwen adapter installs once and proxies workspace lifecycle", async (t) => {
  const root = await extensionFixture(t);
  const fixture = invocationContext("qwen", (calls) => {
    if (calls.length === 1) {
      throw new Error("Extension with name codegraph-agent does not exist.");
    }
    if (calls.at(-1)[1].join(" ") === "extensions list") {
      return "✓ codegraph-agent (1.0.0)\n Enabled (Workspace): true";
    }
    return "done";
  });
  const payload = extension(root);

  await agentAdapter.invokeExtension(fixture.context, payload, {
    operation: "connect",
    ownerId: "codegraph",
  });
  await agentAdapter.invokeExtension(fixture.context, payload, {
    operation: "connect",
    ownerId: "codegraph",
  });
  await agentAdapter.invokeExtension(fixture.context, payload, {
    operation: "status",
    ownerId: "codegraph",
  });
  await agentAdapter.invokeExtension(fixture.context, payload, {
    operation: "disconnect",
    ownerId: "codegraph",
  });
  assert.deepEqual(fixture.calls, [
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
    ["qwen", [
      "extensions", "install", `${root}:codegraph-agent`,
      "--scope", "project", "--consent",
    ]],
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "disable", "codegraph-agent", "--scope", "workspace"]],
  ]);
  assert.equal(fixture.calls.every(([, args]) => Object.isFrozen(args)), true);
});

test("GigaCode adapter requires gigacode-extension.json while using Qwen CLI", async (t) => {
  const root = await extensionFixture(t, "openspec-gigacode-extension-");
  await fs.rm(path.join(root, "qwen-extension.json"));
  const fixture = invocationContext("gigacode", (calls) => {
    if (calls.length === 1) {
      throw new Error("Extension with name codegraph-agent does not exist.");
    }
    return "installed";
  });

  assert.equal(await agentAdapter.invokeExtension(
    fixture.context,
    extension(root),
    { operation: "connect", ownerId: "codegraph" },
  ), "installed");
  assert.deepEqual(fixture.calls, [
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
    ["qwen", [
      "extensions", "install", `${root}:codegraph-agent`,
      "--scope", "project", "--consent",
    ]],
  ]);

  await fs.rm(path.join(root, "gigacode-extension.json"));
  await fs.writeFile(
    path.join(root, "qwen-extension.json"),
    `${JSON.stringify({ name: "codegraph-agent" })}\n`,
  );
  await assert.rejects(
    agentAdapter.invokeExtension(
      fixture.context,
      extension(root),
      { operation: "connect", ownerId: "codegraph" },
    ),
    /gigacode-extension\.json/u,
  );
});

test("Qwen adapter does not replace an enable failure with install", async (t) => {
  const root = await extensionFixture(t, "openspec-qwen-enable-failure-");
  const fixture = invocationContext("qwen", () => {
    throw new Error("workspace is not writable");
  });

  await assert.rejects(
    agentAdapter.invokeExtension(
      fixture.context,
      extension(root),
      { operation: "connect", ownerId: "codegraph" },
    ),
    /AGENT_EXTENSION_NATIVE_FAILED.*workspace is not writable/u,
  );
  assert.deepEqual(fixture.calls, [
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
  ]);
});

test("Claude adapter proxies local marketplace lifecycle", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-extension-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  const fixture = invocationContext("claude", (calls) => (
    calls.at(-1)[1].includes("list")
      ? JSON.stringify([{ id: qualified, enabled: true }])
      : `result-${calls.length}`
  ));
  const payload = extension(root);

  assert.equal(await agentAdapter.invokeExtension(
    fixture.context,
    payload,
    { operation: "connect", ownerId: "codegraph" },
  ), "result-2");
  await agentAdapter.invokeExtension(
    fixture.context,
    payload,
    { operation: "status", ownerId: "codegraph" },
  );
  await agentAdapter.invokeExtension(
    fixture.context,
    payload,
    { operation: "disconnect", ownerId: "codegraph" },
  );

  assert.deepEqual(fixture.calls, [
    ["claude", ["plugin", "marketplace", "add", root, "--scope", "local"]],
    ["claude", ["plugin", "install", qualified, "--scope", "local"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "uninstall", qualified, "--scope", "local"]],
    ["claude", ["plugin", "marketplace", "remove", "openspec-orch-codegraph-agent", "--scope", "local"]],
  ]);
});

test("Agent status requires the exact Extension to be present and enabled", async (t) => {
  const root = await extensionFixture(t, "openspec-agent-status-");
  const payload = extension(root);

  for (const [agentId, output, expected] of [
    ["qwen", "No extensions installed.", /AGENT_EXTENSION_STATUS_MISSING.*codegraph-agent/u],
    ["qwen", "✗ codegraph-agent (1.0.0)", /AGENT_EXTENSION_STATUS_DISABLED.*codegraph-agent/u],
    ["claude", "[]", /AGENT_EXTENSION_STATUS_MISSING.*codegraph-agent@openspec-orch-codegraph-agent/u],
    [
      "claude",
      JSON.stringify([{
        id: "codegraph-agent@openspec-orch-codegraph-agent",
        enabled: false,
      }]),
      /AGENT_EXTENSION_STATUS_DISABLED.*codegraph-agent@openspec-orch-codegraph-agent/u,
    ],
  ]) {
    const fixture = invocationContext(agentId, output);
    await assert.rejects(
      agentAdapter.invokeExtension(
        fixture.context,
        payload,
        { operation: "status", ownerId: "codegraph" },
      ),
      expected,
    );
  }
});

test("Claude adapter preflight validates marketplace identity before native mutation", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-marketplace-");
  await fs.writeFile(
    path.join(root, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify({
      name: "wrong-marketplace",
      plugins: [{ name: "codegraph-agent", source: "./" }],
    })}\n`,
  );
  const fixture = invocationContext("claude");

  await assert.rejects(
    agentAdapter.validateExtension(extension(root), { ownerId: "codegraph" }),
    /Claude marketplace/u,
  );
  assert.deepEqual(fixture.calls, []);
});

test("AgentExtensionAdapter validates all manifests and preserves native diagnostics", async (t) => {
  const root = await extensionFixture(t);
  const payload = extension(root);
  await agentAdapter.validateExtension(payload, { ownerId: "codegraph" });

  await fs.rm(path.join(root, "gigacode-extension.json"));
  await assert.rejects(
    agentAdapter.validateExtension(payload, { ownerId: "codegraph" }),
    /gigacode-extension\.json/u,
  );

  const context = Object.freeze({
    agent: Object.freeze({ id: "qwen" }),
    process: Object.freeze({ async run() { throw new Error("registration is missing"); } }),
  });
  await assert.rejects(
    agentAdapter.invokeExtension(context, payload, {
      operation: "status",
      ownerId: "codegraph",
    }),
    /AGENT_EXTENSION_NATIVE_FAILED.*\["qwen","extensions","list"\].*registration is missing/u,
  );
  await assert.rejects(
    agentAdapter.invokeExtension(context, payload, { operation: "exec" }),
    /поддерживаемая operation/u,
  );
});
