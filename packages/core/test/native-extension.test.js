/** @fileoverview Native Extension boundaries without provider accounts or paid APIs. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adaptOpenSpecPack, nativeExtensionId, preflightNative, readNativeManifest,
  requireNativeManifest, runNative,
} from "../../../agents/native-extension.js";
import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Creates one isolated root and cleans only that fixture. */
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-extension-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("native IDs distinguish standalone Extensions and Plugin contributions", () => {
  assert.equal(nativeExtensionId("skills"), "skills");
  assert.equal(nativeExtensionId("skills", "workflow"), "workflow-skills");
});

test("native pack rejects missing, regular-file and symlink source directories", async (t) => {
  const root = await fixture(t);
  const source = path.join(root, "generated");
  const options = { targetRoot: root, agent: {
    generatedDirectory: "generated", targetDirectory: "native",
  } };
  await assert.rejects(adaptOpenSpecPack(options), /AGENT_PACK_INVALID/);
  await fs.writeFile(source, "user-owned");
  await assert.rejects(adaptOpenSpecPack(options), /AGENT_PACK_INVALID/);
  assert.equal(await fs.readFile(source, "utf8"), "user-owned");
  await fs.unlink(source);
  const outside = await fixture(t);
  await createDirectoryLink(outside, source);
  await assert.rejects(adaptOpenSpecPack(options), /AGENT_PACK_INVALID/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("native pack relocation preserves content and never overwrites an existing target", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "generated"));
  await fs.writeFile(path.join(root, "generated", "payload"), "original");
  const options = { targetRoot: root, agent: {
    generatedDirectory: "generated", targetDirectory: "nested/native",
  } };
  await adaptOpenSpecPack({ ...options, agent: {
    generatedDirectory: "generated", targetDirectory: "generated",
  } });
  await adaptOpenSpecPack(options);
  assert.equal(await fs.readFile(path.join(root, "nested/native/payload"), "utf8"), "original");
  await fs.mkdir(path.join(root, "generated"));
  await assert.rejects(adaptOpenSpecPack(options), /уже существует/);
  assert.equal(await fs.readFile(path.join(root, "nested/native/payload"), "utf8"), "original");
});

test("native manifests reject missing, outside-root and directory paths", async (t) => {
  const root = await fixture(t);
  await assert.rejects(requireNativeManifest(root, root), /выходит/);
  await assert.rejects(requireNativeManifest(path.join(root, "../outside.json"), root), /выходит/);
  await assert.rejects(requireNativeManifest(path.join(root, "missing.json"), root), (error) => {
    assert.match(error.message, /AGENT_EXTENSION_INVALID/);
    assert.equal(error.cause.code, "ENOENT");
    return true;
  });
  await fs.mkdir(path.join(root, "directory"));
  await assert.rejects(requireNativeManifest(path.join(root, "directory"), root), /обычным файлом/);
});

test("native manifest validates JSON and rejects symlink traversal", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const manifest = path.join(root, "manifest.json");
  await fs.writeFile(manifest, '{"name":"safe"}');
  assert.deepEqual(await readNativeManifest(manifest, root), { name: "safe" });
  await fs.writeFile(manifest, "{broken");
  await assert.rejects(readNativeManifest(manifest, root), (error) => {
    assert.match(error.message, /некорректный JSON/);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
  await fs.writeFile(path.join(outside, "manifest.json"), '{"name":"outside"}');
  await createDirectoryLink(outside, path.join(root, "linked"));
  await assert.rejects(readNativeManifest(path.join(root, "linked/manifest.json"), root), /symlink/);
  assert.equal(await fs.readFile(path.join(outside, "manifest.json"), "utf8"), '{"name":"outside"}');
});

test("native command freezes a separate argv and preserves exact scope and failure cause", async () => {
  const args = ["extensions", "install", "path with spaces"];
  const cause = new Error("native denied");
  const context = { agent: { id: "qwen", executable: "qwen", scope: "project" }, process: {
    run: async (executable, argv) => {
      assert.equal(executable, "qwen");
      assert.notEqual(argv, args);
      assert.ok(Object.isFrozen(argv));
      assert.deepEqual(argv, args);
      throw cause;
    },
  } };
  for (const extension of [
    { id: "demo" },
    { id: "demo", source: "./local-extension", target: { id: "frontend" } },
  ]) {
    await assert.rejects(runNative(context, extension, args), (error) => {
      assert.equal(error.cause, cause);
      assert.match(error.message, /AGENT_EXTENSION_NATIVE_FAILED/);
      assert.ok(error.message.includes(`target=${extension.target?.id ?? "unknown"}`));
      assert.ok(error.message.includes(`source=${extension.source ?? "plugin-contribution"}`));
      assert.ok(error.message.includes('scope=project'));
      assert.ok(error.message.includes(JSON.stringify(["qwen", ...args])));
      return true;
    });
  }
  context.process.run = async () => "installed";
  assert.equal(await runNative(context, { id: "demo" }, args), "installed");
});

test("native preflight invokes only immutable --version and preserves errors", async () => {
  const cause = new Error("not installed");
  const context = { agent: { id: "qwen", executable: "qwen" }, process: {
    run: async (executable, argv) => {
      assert.equal(executable, "qwen");
      assert.deepEqual(argv, ["--version"]);
      assert.ok(Object.isFrozen(argv));
      throw cause;
    },
  } };
  await assert.rejects(preflightNative(context), (error) => {
    assert.match(error.message, /AGENT_PREFLIGHT_FAILED/);
    assert.equal(error.cause, cause);
    return true;
  });
  context.process.run = async () => "1.0.0";
  assert.equal(await preflightNative(context), "1.0.0");
});
