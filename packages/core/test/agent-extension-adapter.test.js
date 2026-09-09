/** @fileoverview Проверки generic router и distribution Agent adapters. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
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
async function extensionFixture(
  t,
  prefix = "openspec-agent-extension-",
  nativeId = "codegraph-agent",
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".claude-plugin"));
  const manifest = `${JSON.stringify({ name: nativeId })}\n`;
  await Promise.all([
    fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), manifest),
    fs.writeFile(path.join(root, ".claude-plugin", "marketplace.json"), `${JSON.stringify({
      name: `openspec-orch-${nativeId}`,
      plugins: [{ name: nativeId, source: "./" }],
    })}\n`),
    fs.writeFile(path.join(root, "qwen-extension.json"), manifest),
    fs.writeFile(path.join(root, "gigacode-extension.json"), manifest),
  ]);
  return root;
}

/** Собирает минимальный scoped Agent context и журнал native calls. */
function invocationContext(agentId, result = "done", cwd = process.cwd()) {
  const calls = [];
  return {
    calls,
    context: Object.freeze({
      agent: Object.freeze({ id: agentId }),
      process: Object.freeze({
        cwd,
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

test("GigaCode preflight uses its own native executable", async () => {
  const fixture = invocationContext("gigacode", "1.0.0");

  assert.equal(await agentAdapter.preflight(fixture.context), "1.0.0");
  assert.deepEqual(fixture.calls, [["gigacode", ["--version"]]]);
});

test("Qwen adapter installs once and proxies workspace lifecycle", async (t) => {
  const root = await extensionFixture(t);
  let installed = false;
  const fixture = invocationContext("qwen", (calls) => {
    const operation = calls.at(-1)[1].join(" ");
    if (operation === "extensions list") {
      return installed
        ? `✓ codegraph-agent (1.0.0)\n Enabled (Workspace): true\n Path: ${root}`
        : "No extensions installed.";
    }
    if (operation.startsWith("extensions install ")) installed = true;
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
    ["qwen", ["extensions", "list"]],
    ["qwen", [
      "extensions", "install", `${root}:codegraph-agent`,
      "--scope", "project", "--consent",
    ]],
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "disable", "codegraph-agent", "--scope", "workspace"]],
  ]);
  assert.equal(fixture.calls.every(([, args]) => Object.isFrozen(args)), true);
});

test("GigaCode adapter requires its manifest and uses GigaCode CLI", async (t) => {
  const root = await extensionFixture(t, "openspec-gigacode-extension-");
  await fs.rm(path.join(root, "qwen-extension.json"));
  const fixture = invocationContext("gigacode", (calls) => {
    if (calls.at(-1)[1].join(" ") === "extensions list") return calls.length === 1
      ? "Расширения не установлены." : `✓ codegraph-agent (1.0.0)\n Path: ${root}\n Enabled (Workspace): true`;
    return "installed";
  });

  assert.equal(await agentAdapter.invokeExtension(
    fixture.context,
    extension(root),
    { operation: "connect", ownerId: "codegraph" },
  ), "installed");
  assert.deepEqual(fixture.calls, [
    ["gigacode", ["extensions", "list"]],
    ["gigacode", [
      "extensions", "install", `${root}:codegraph-agent`,
      "--scope", "project", "--consent",
    ]],
    ["gigacode", ["extensions", "list"]],
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

for (const agentId of ["qwen", "gigacode"]) {
  test(`${agentId} adapter selects and removes the gateway in explicit user scope`, async (t) => {
    const root = await extensionFixture(
      t,
      `openspec-${agentId}-user-gateway-`,
      "orchestrator-agent",
    );
    const fixture = invocationContext(agentId, (calls) => {
      if (calls.at(-1)[1].join(" ") === "extensions list") {
        const listCalls = calls.filter(([, args]) => args.join(" ") === "extensions list");
        if (listCalls.length === 1) return "No extensions installed.";
        return agentId === "gigacode"
          ? `✓ orchestrator-agent (1.0.0)\n Включено (Пользователь): true\n Path: ${root}\n` +
            " Включено (Рабочее пространство): true"
          : `✓ orchestrator-agent (1.0.0)\n Enabled (User): true\n Path: ${root}`;
      }
      return "done";
    });
    const payload = extension(root, "orchestrator-agent");

    await agentAdapter.invokeExtension(
      fixture.context,
      payload,
      { operation: "connect", scope: "user" },
    );
    await agentAdapter.invokeExtension(
      fixture.context,
      payload,
      { operation: "status", scope: "user" },
    );
    await agentAdapter.invokeExtension(
      fixture.context,
      payload,
      { operation: "remove", scope: "user" },
    );
    const executable = agentId === "gigacode" ? "gigacode" : "qwen";
    assert.deepEqual(fixture.calls, [
      [executable, ["extensions", "list"]],
      [executable, [
        "extensions", "install", `${root}:orchestrator-agent`,
        "--scope", "user", "--consent",
      ]],
      [executable, ["extensions", "list"]],
      [executable, ["extensions", "list"]],
      [executable, ["extensions", "uninstall", "orchestrator-agent"]],
    ]);
  });
}

test("GigaCode localized status still requires the requested scope", async (t) => {
  const root = await extensionFixture(
    t,
    "openspec-gigacode-localized-scope-",
    "orchestrator-agent",
  );
  const fixture = invocationContext(
    "gigacode",
    `✓ orchestrator-agent (1.0.0)\n Включено (Рабочее пространство): true\n Path: ${root}`,
  );

  await assert.rejects(
    agentAdapter.invokeExtension(
      fixture.context,
      extension(root, "orchestrator-agent"),
      { operation: "status", scope: "user" },
    ),
    /AGENT_EXTENSION_STATUS_SCOPE_MISSING: orchestrator-agent \(user\)/u,
  );
});

test("GigaCode accepts Russian and English user scope markers", async (t) => {
  const root = await extensionFixture(
    t,
    "openspec-gigacode-status-locales-",
    "orchestrator-agent",
  );
  const payload = extension(root, "orchestrator-agent");

  for (const output of [
    `✓ orchestrator-agent (1.0.0)\n Enabled (User): true\n Path: ${root}`,
    `✓ orchestrator-agent (1.0.0)\n Включено (Пользователь): true\n Path: ${root}`,
  ]) {
    const fixture = invocationContext("gigacode", output);
    assert.equal(await agentAdapter.invokeExtension(
      fixture.context,
      payload,
      { operation: "status", scope: "user" },
    ), output);
  }
});

test("Qwen adapter does not replace an enable failure with install", async (t) => {
  const root = await extensionFixture(t, "openspec-qwen-enable-failure-");
  const fixture = invocationContext("qwen", (calls) => {
    if (calls.at(-1)[1].join(" ") === "extensions list") {
      return `✗ codegraph-agent (1.0.0)\n Enabled (Workspace): false\n Path: ${root}`;
    }
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
    ["qwen", ["extensions", "list"]],
    ["qwen", ["extensions", "enable", "codegraph-agent", "--scope", "workspace"]],
  ]);
});

test("Claude adapter proxies local marketplace lifecycle", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-extension-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  const fixture = invocationContext("claude", (calls) => (
    calls.at(-1)[1].includes("list")
      ? JSON.stringify(calls.some(([, args]) => args.includes("uninstall"))
        ? [] : [{ id: qualified, installPath: root, enabled: true, scope: "local", projectPath: process.cwd() }])
      : `result-${calls.length}`
  ));
  const payload = extension(root);

  assert.equal(await agentAdapter.invokeExtension(
    fixture.context,
    payload,
    { operation: "connect", ownerId: "codegraph" },
  ), JSON.stringify([{ id: qualified, installPath: root, enabled: true, scope: "local", projectPath: process.cwd() }]));
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
    ["claude", ["plugin", "update", qualified, "--scope", "local"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "uninstall", qualified, "--scope", "local"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "marketplace", "remove", "openspec-orch-codegraph-agent", "--scope", "local"]],
  ]);
});

test("Claude status ignores a local Extension enabled for another project", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-other-project-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  const fixture = invocationContext("claude", JSON.stringify([{
    id: qualified,
    enabled: true,
    scope: "local",
    projectPath: path.join(root, "other-project"),
  }]), path.join(root, "current-project"));

  await assert.rejects(
    agentAdapter.invokeExtension(
      fixture.context,
      extension(root),
      { operation: "status", ownerId: "codegraph" },
    ),
    /AGENT_EXTENSION_STATUS_PROJECT_MISMATCH.*codegraph-agent@openspec-orch-codegraph-agent/u,
  );

});

test("Claude adapter honors explicit user scope for the gateway", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-user-gateway-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  const fixture = invocationContext("claude", (calls) => (
    calls.at(-1)[1].includes("list")
      ? JSON.stringify(calls.some(([, args]) => args.includes("uninstall"))
        ? [] : [{ id: qualified, installPath: root, enabled: true, scope: "user" }])
      : "done"
  ));

  await agentAdapter.invokeExtension(
    fixture.context,
    extension(root, "codegraph-agent"),
    { operation: "connect", scope: "user" },
  );
  await agentAdapter.invokeExtension(
    fixture.context,
    extension(root, "codegraph-agent"),
    { operation: "status", scope: "user" },
  );
  await agentAdapter.invokeExtension(
    fixture.context,
    extension(root, "codegraph-agent"),
    { operation: "remove", scope: "user" },
  );
  assert.deepEqual(fixture.calls, [
    ["claude", ["plugin", "marketplace", "add", root, "--scope", "user"]],
    ["claude", [
      "plugin", "install", "codegraph-agent@openspec-orch-codegraph-agent", "--scope", "user",
    ]],
    ["claude", ["plugin", "update", qualified, "--scope", "user"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", [
      "plugin", "uninstall", "codegraph-agent@openspec-orch-codegraph-agent", "--scope", "user",
    ]],
    ["claude", ["plugin", "list", "--json"]],
    ["claude", [
      "plugin", "marketplace", "remove", "openspec-orch-codegraph-agent", "--scope", "user",
    ]],
  ]);
});

test("Agent status requires the exact Extension to be present and enabled", async (t) => {
  const root = await extensionFixture(t, "openspec-agent-status-");
  const payload = extension(root);

  for (const [agentId, output, expected] of [
    ["qwen", "No extensions installed.", /AGENT_EXTENSION_STATUS_MISSING.*codegraph-agent/u],
    ["qwen", `✗ codegraph-agent (1.0.0)\n Path: ${root}`, /AGENT_EXTENSION_STATUS_DISABLED.*codegraph-agent/u],
    ["claude", "[]", /AGENT_EXTENSION_STATUS_MISSING.*codegraph-agent@openspec-orch-codegraph-agent/u],
    [
      "claude",
      JSON.stringify([{
        id: "codegraph-agent@openspec-orch-codegraph-agent",
        enabled: false,
        scope: "local",
        projectPath: process.cwd(),
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

test("AgentExtensionAdapter validates only the selected Agent for standalone payload", async (t) => {
  const root = await extensionFixture(t);
  await fs.rm(path.join(root, "gigacode-extension.json"));
  const payload = Object.freeze({
    ...extension(root),
    manifests: Object.freeze({ qwen: "qwen-extension.json" }),
  });

  await agentAdapter.validateExtension(payload, { agentId: "qwen", ownerId: "codegraph" });
  await assert.rejects(
    agentAdapter.validateExtension(payload, { agentId: "gigacode", ownerId: "codegraph" }),
    /Agent 'gigacode' не поддерживается/,
  );
});

for (const agentId of ["qwen", "gigacode"]) {
  test(`${agentId} rejects broken marketplace selectors before native calls`, async (t) => {
    const root = await extensionFixture(t);
    const marketplace = path.join(root, ".claude-plugin/marketplace.json");
    const fixture = invocationContext(agentId);
    const connect = () => agentAdapter.invokeExtension(fixture.context, extension(root), {
      operation: "connect", ownerId: "codegraph",
    });
    await fs.rm(marketplace);
    await assert.rejects(connect(), /marketplace\.json/u);
    for (const plugins of [[], [{ name: "other", source: "./" }],
      [{ name: "codegraph-agent", source: "../outside" }],
      [{ name: "codegraph-agent", source: "./" }, { name: "codegraph-agent", source: "./" }]]) {
      await fs.writeFile(marketplace, JSON.stringify({ plugins }));
      await assert.rejects(connect(), /marketplace должен объявлять/u);
    }
    assert.deepEqual(fixture.calls, []);
  });
}


test("Claude disconnect preserves another project's marketplace and is repeatable", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-shared-marketplace-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  let registrations = [process.cwd(), path.join(root, "other")].map((projectPath) => ({
    id: qualified, installPath: root, scope: "local", enabled: true, projectPath,
  }));
  const fixture = invocationContext("claude", (calls) => {
    const args = calls.at(-1)[1];
    if (args.includes("uninstall")) registrations = registrations.filter((p) => p.projectPath !== process.cwd());
    return args.includes("list") ? JSON.stringify(registrations) : "done";
  });
  const request = { operation: "disconnect", ownerId: "codegraph" };
  await agentAdapter.invokeExtension(fixture.context, extension(root), request);
  await agentAdapter.invokeExtension(fixture.context, extension(root), request);
  assert.equal(registrations.length, 1);
  assert.equal(fixture.calls.filter(([, args]) => args.includes("uninstall")).length, 1);
  assert.equal(fixture.calls.some(([, args]) => args.includes("remove")), false);
});

test("Claude scopes Plugin-owned status and disconnect through a process facade without cwd", async (t) => {
  const root = await extensionFixture(t, "openspec-claude-hidden-cwd-");
  const qualified = "codegraph-agent@openspec-orch-codegraph-agent";
  let installed = [{ id: qualified, installPath: root, scope: "local", enabled: true, projectPath: root }];
  const calls = [];
  const context = { agent: { id: "claude" }, process: {
    async run(executable, args) {
      calls.push([executable, args]);
      if (executable === process.execPath) return `${root}\n`;
      if (args.includes("uninstall")) installed = [];
      return args.includes("list") ? JSON.stringify(installed) : "done";
    },
  } };
  await agentAdapter.invokeExtension(context, extension(root), { operation: "status", ownerId: "codegraph" });
  await agentAdapter.invokeExtension(context, extension(root), { operation: "disconnect", ownerId: "codegraph" });
  assert.equal(installed.length, 0);
  assert.equal(calls.filter(([executable]) => executable === process.execPath).length, 2);
  assert.equal(calls.some(([, args]) => args.includes("remove")), true);
});

for (const agentId of ["qwen", "gigacode"]) {
  test(`${agentId} default status requires activation in the current workspace`, async (t) => {
    const root = await extensionFixture(t);
    const fixture = invocationContext(agentId,
      `✓ codegraph-agent (1.0.0)\n Enabled (User): true\n Enabled (Workspace): false\n Path: ${root}`);
    await assert.rejects(agentAdapter.invokeExtension(fixture.context, extension(root),
      { operation: "status", ownerId: "codegraph" }), /AGENT_EXTENSION_STATUS_SCOPE_MISSING/u);
  });
}

for (const agentId of ["qwen", "gigacode", "claude"]) {
  test(`${agentId} detects stale installed files and verifies reconnect`, async (t) => {
    const root = await extensionFixture(t, "openspec-refresh-source-", "agent");
    await fs.writeFile(path.join(root, "agent-instructions.md"), "current instructions");
    const installedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-refresh-installed-"));
    t.after(() => fs.rm(installedRoot, { recursive: true, force: true }));
    await fs.cp(root, installedRoot, { recursive: true });
    await fs.writeFile(path.join(installedRoot, "agent-instructions.md"), "outdated instructions");
    let updateWorks = false;
    const fixture = invocationContext(agentId, async (calls) => {
      const args = calls.at(-1)[1];
      if (args[1] === "update" && updateWorks) await fs.cp(root, installedRoot, { recursive: true });
      if (agentId === "claude" && args[1] === "list") return JSON.stringify([
        { id: "agent@openspec-orch-agent", scope: "user", enabled: true, installPath: installedRoot },
      ]);
      if (args[1] === "list") return `✓ agent (1.0.0)\n Path: ${installedRoot}\n Enabled (User): true`;
      return "done";
    });
    const payload = extension(root);
    const status = { operation: "status", scope: "user" };
    await assert.rejects(agentAdapter.invokeExtension(fixture.context, payload, status), /STATUS_STALE.*agent-instructions/u);
    assert.equal(fixture.calls.length, 1, "status is read-only");
    await assert.rejects(agentAdapter.invokeExtension(fixture.context, payload, { ...status, operation: "connect" }), /STATUS_STALE/u);
    updateWorks = true;
    await agentAdapter.invokeExtension(fixture.context, payload, { ...status, operation: "connect" });
    await agentAdapter.invokeExtension(fixture.context, payload, status);
    assert.equal(fixture.calls.some(([, args]) => args[1] === "uninstall"), false);
    await fs.writeFile(path.join(installedRoot, "obsolete-command.md"), "removed upstream");
    await assert.rejects(agentAdapter.invokeExtension(fixture.context, payload, status), /STATUS_STALE.*removed file/u);
  });
}
