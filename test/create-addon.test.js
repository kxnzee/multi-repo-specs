/** @fileoverview Реальный authoring CLI: генерация, повреждение пакета и выполнение примера. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { execa } from "execa";
import { AddonAuthoringService, ProjectTemplateService, validateAddon } from "@openspec-orch/core";
import { loadBundledAgentProvider } from "../src/bin/internal/distribution.js";
import { createDirectoryLink } from "../src/packages/core/fixtures/filesystem.js";

const cli = fileURLToPath(new URL("../src/bin/openspec-orch.js", import.meta.url));
const sdk = fileURLToPath(new URL("../src/packages/plugin-sdk", import.meta.url));

/** Временный workspace удаляется после закрытия дочерних процессов. */
async function workspace(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "orch-author-test-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/** Выполняет публичную команду без TTY и разбирает её единственный JSON ответ. */
async function run(args, cwd) {
  const result = await execa(process.execPath, [cli, "create", ...args, "--json"], { cwd, reject: false });
  assert.equal(result.stderr, "");
  return { code: result.exitCode, data: JSON.parse(result.stdout) };
}

test("authoring CLI creates standalone Extension and rejects edited manifests and skills", async (t) => {
  const root = await workspace(t);
  const created = await run(["extension", "review-rules", "my extension", "--agent", "qwen", "--target", "code"], root);
  assert.equal(created.code, 0, JSON.stringify(created.data));
  assert.equal(created.data.behavior, "not-tested");
  const target = created.data.root;
  assert.equal(await fs.readFile(path.join(target, "qwen-extension.json"), "utf8").then(JSON.parse).then((value) => value.name), "review-rules");
  // Qwen's native install selector also needs the shared marketplace.
  await fs.access(path.join(target, ".claude-plugin/marketplace.json"));
  const agents = await loadBundledAgentProvider();
  await validateAddon({ kind: "extension", root: target, agentProvider: agents });
  await fs.writeFile(path.join(target, "qwen-extension.json"), '{"name":"wrong"}');
  const broken = await run(["validate", target, "--kind", "extension"], root);
  assert.equal(broken.code, 1);
  assert.match(broken.data.error.message, /native ID/u);
  await fs.writeFile(path.join(target, "skills/review-rules/SKILL.md"), "missing frontmatter");
  assert.equal((await run(["validate", target, "--kind", "extension"], root)).data.error.code, "AUTHORING_SKILL_INVALID");
});

test("generated Plugin loads the public SDK, passes contract and runs inspect", async (t) => {
  const root = await workspace(t);
  for (const profile of ["commands", "repository", "native"]) {
    const created = await run(["plugin", `demo-${profile}`, profile, "--profile", profile,
      "--name", 'Название */ " example', ...(profile === "native" ? ["--extension"] : [])], root);
    assert.equal(created.code, 0, JSON.stringify(created.data));
    const target = created.data.root;
    await fs.mkdir(path.join(target, "node_modules/@openspec-orch"), { recursive: true });
    await createDirectoryLink(sdk, path.join(target, "node_modules/@openspec-orch/plugin-sdk"));
    const loaded = await run(["validate", target, "--kind", "plugin", "--load"], root);
    assert.equal(loaded.code, 0, JSON.stringify(loaded.data));
    assert.ok(loaded.data.checks.includes("plugin-export-and-commands"));
    await execa(process.execPath, ["--test"], { cwd: target });
    const url = pathToFileURL(path.join(target, "index.js")).href;
    if (profile === "commands") {
      const result = await execa(process.execPath, ["--input-type=module", "-e", `const {default: plugin} = await import(${JSON.stringify(url)}); await plugin.exec({}, ['inspect']);`]);
      assert.equal(result.stdout, "demo-commands: ready");
      await fs.writeFile(path.join(target, "index.js"), "export default {");
      assert.equal((await run(["validate", target, "--kind", "plugin"], root)).code, 1);
    } else {
      const { default: plugin } = await import(url);
      assert.throws(() => plugin.connect({}), /NOT_IMPLEMENTED/u);
    }
  }
});

test("generated Extension installs as an npm package and delivers its static context", async (t) => {
  const root = await workspace(t);
  const created = await run(["extension", "static-context", "source"], root);
  assert.equal(created.code, 0, JSON.stringify(created.data));
  const consumer = path.join(root, "consumer");
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, "package.json"), '{"name":"authoring-consumer","private":true}');
  await execa(process.execPath, [process.env.npm_execpath, "install", "--ignore-scripts", "--install-links", "--no-audit", "--no-fund", created.data.root], {
    cwd: consumer, env: { NPM_CONFIG_CACHE: path.join(root, "npm-cache") }, timeout: 30000,
  });
  const installed = path.join(consumer, "node_modules/openspec-orch-extension-static-context");
  const result = await run(["validate", installed, "--kind", "extension"], consumer);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  const expected = await fs.readFile(path.join(installed, "agent-instructions.md"), "utf8");
  const hook = await execa(process.execPath, [path.join(installed, "hooks/session-start.js")]);
  assert.equal(hook.stdout, expected.trimEnd());
  for (const agent of ["qwen", "gigacode"]) {
    const manifest = JSON.parse(await fs.readFile(path.join(installed, `${agent}-extension.json`), "utf8"));
    assert.equal(await fs.readFile(path.join(installed, manifest.contextFileName), "utf8"), expected);
  }
  await fs.access(path.join(installed, "skills/static-context/SKILL.md"));
});

test("generated Template plans and copies for every provider and rejects protected paths", async (t) => {
  const root = await workspace(t);
  const created = await run(["template", "team-context", "template"], root);
  assert.equal(created.code, 0, JSON.stringify(created.data));
  const provider = await loadBundledAgentProvider();
  for (const { id } of provider.catalog.entries) {
    const targetRoot = path.join(root, id);
    await fs.mkdir(targetRoot);
    const plan = await new ProjectTemplateService().plan({ templateRoot: created.data.root, targetRoot, agent: provider.resolve(id) });
    await plan.install();
    assert.match(await fs.readFile(path.join(targetRoot, "openspec/context/README.md"), "utf8"), /team-context/u);
    await fs.access(path.join(targetRoot, provider.resolve(id).instructionsFile));
  }
  await fs.writeFile(path.join(created.data.root, "template.yaml"), "id: team-context\nname: Team\ncopy:\n  - from: context\n    to: .git\n");
  assert.equal((await run(["validate", created.data.root, "--kind", "template"], root)).code, 1);
});

test("invalid and concurrent creation preserves existing files and returns machine errors", async (t) => {
  const root = await workspace(t);
  await fs.mkdir(path.join(root, "existing"));
  await fs.writeFile(path.join(root, "existing/sentinel"), "keep");
  const existing = await run(["extension", "demo", "existing"], root);
  assert.equal(existing.code, 1);
  assert.equal(existing.data.error.code, "AUTHORING_TARGET_EXISTS");
  assert.equal(await fs.readFile(path.join(root, "existing/sentinel"), "utf8"), "keep");
  assert.equal((await run(["extension", "demo", "invalid", "--agent", "unknown"], root)).code, 1);
  await assert.rejects(fs.access(path.join(root, "invalid")), { code: "ENOENT" });
  assert.equal((await run(["validate", root, "--kind", "invalid"], root)).code, 1);
  const service = new AddonAuthoringService({ agentProvider: await loadBundledAgentProvider() });
  const options = { kind: "extension", id: "racing", targetRoot: path.join(root, "racing") };
  const outcomes = await Promise.allSettled([service.create(options), service.create(options)]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  await fs.access(path.join(options.targetRoot, "extension.yaml"));
});

test("Extension validation rejects a broken JavaScript hook", async (t) => {
  const root = await workspace(t);
  const created = await run(["extension", "broken-hook", "source"], root);
  assert.equal(created.code, 0);
  await fs.writeFile(path.join(created.data.root, "hooks/session-start.js"), "const broken = ;");
  const result = await run(["validate", created.data.root, "--kind", "extension"], root);
  assert.equal(result.code, 1);
});

test("Plugin load must complete contract verification rather than just exit successfully", async (t) => {
  const root = await workspace(t);
  const created = await run(["plugin", "early-exit", "source"], root);
  assert.equal(created.code, 0);
  await fs.writeFile(path.join(created.data.root, "index.js"), 'import process from "node:process"; process.exit(0);');
  const result = await run(["validate", created.data.root, "--kind", "plugin", "--load"], root);
  assert.equal(result.code, 1);
  assert.equal(result.data.error.code, "AUTHORING_PLUGIN_CHECK_INCOMPLETE");
});
