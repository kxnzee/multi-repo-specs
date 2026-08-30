/** @fileoverview Детерминированная npm materialization boundary для Plugin integration tests. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PluginLoader } from "@openspec-orch/core";

export const SAMPLE_PLUGIN_ROOT = await fs.realpath(fileURLToPath(
  new URL("../../../../test-fixtures/plugin-sdk/sample-plugin/", import.meta.url),
));
export const PLUGIN_SDK_ROOT = await fs.realpath(fileURLToPath(
  new URL("../../../plugin-sdk/", import.meta.url),
));
export const PLUGIN_SDK_VERSION = JSON.parse(
  await fs.readFile(path.join(PLUGIN_SDK_ROOT, "package.json")),
).version;

/** Loads an observed Plugin export through one real temporary package boundary. */
export async function loadPluginExport(t, plugin) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-test-plugin-"));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const manifest = {
    name: `@test/openspec-orch-plugin-${plugin.id}`,
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  };
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(packageRoot, "index.js"), "export default {};\n");
  return new PluginLoader(async () => ({ default: plugin })).load({
    packageRoot: await fs.realpath(packageRoot),
    pluginId: plugin.id,
  });
}

/** Materialize sample Plugin и SDK так, как это сделал бы успешный npm install. */
export function createPluginMaterializer({
  sourceRoot = SAMPLE_PLUGIN_ROOT,
  version = "1.0.0",
} = {}) {
  return {
    async install({ runtimeRoot }) {
      const manifestPath = path.join(runtimeRoot, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const pluginManifest = JSON.parse(await fs.readFile(path.join(sourceRoot, "package.json")));
      pluginManifest.version = version;
      manifest.dependencies[pluginManifest.name] = `file:${sourceRoot}`;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const pluginTarget = path.join(runtimeRoot, "node_modules", ...pluginManifest.name.split("/"));
      const sdkTarget = path.join(
        runtimeRoot,
        "node_modules",
        "@openspec-orch",
        "plugin-sdk",
      );
      await fs.mkdir(path.dirname(pluginTarget), { recursive: true });
      await fs.mkdir(path.dirname(sdkTarget), { recursive: true });
      await fs.cp(sourceRoot, pluginTarget, { recursive: true });
      await fs.cp(PLUGIN_SDK_ROOT, sdkTarget, { recursive: true });
      await fs.writeFile(
        path.join(pluginTarget, "package.json"),
        `${JSON.stringify(pluginManifest, null, 2)}\n`,
      );
      await fs.writeFile(path.join(runtimeRoot, "package-lock.json"), `${JSON.stringify({
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { dependencies: manifest.dependencies },
          "node_modules/@openspec-orch/plugin-sdk": {
            name: "@openspec-orch/plugin-sdk",
            version: PLUGIN_SDK_VERSION,
          },
          [`node_modules/${pluginManifest.name}`]: {
            name: pluginManifest.name,
            version: pluginManifest.version,
            resolved: `file:${sourceRoot}`,
            peerDependencies: pluginManifest.peerDependencies,
          },
        },
      }, null, 2)}\n`);
    },
  };
}
