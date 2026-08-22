/** @fileoverview Универсальное разрешение entrypoint установленного Plugin Package. */

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

/** Возвращает runtime root, проверяя identity bundled package. */
function resolveRuntimeRoot(pluginPackage) {
  if (pluginPackage.installation.kind === "local") return pluginPackage.root;
  const { packageName } = pluginPackage.installation;
  let packageFile;
  try {
    packageFile = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(
      `PLUGIN_RUNTIME_UNAVAILABLE: bundled Plugin Package '${packageName}' не установлен`,
      { cause: error },
    );
  }
  const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
  if (
    manifest.name !== pluginPackage.packageManifest.name ||
    manifest.version !== pluginPackage.packageManifest.version
  ) {
    throw new Error(
      `PLUGIN_RUNTIME_MISMATCH: ${pluginPackage.descriptor.id} ожидает ` +
        `${pluginPackage.packageManifest.name}@${pluginPackage.packageManifest.version}`,
    );
  }
  return path.dirname(packageFile);
}

/**
 * Преобразует логический Plugin invocation в конкретный process invocation.
 * Package без entrypoint сохраняет descriptor command без изменений.
 */
export function resolvePluginInvocation(pluginPackage, invocation) {
  const relativeEntrypoint = pluginPackage?.packageManifest?.openspecOrchestrator.entrypoint;
  if (!relativeEntrypoint) return invocation;
  const entrypoint = path.join(resolveRuntimeRoot(pluginPackage), relativeEntrypoint);
  try {
    if (!statSync(entrypoint).isFile()) throw new Error("entrypoint не является файлом");
  } catch (error) {
    throw new Error(
      `PLUGIN_RUNTIME_UNAVAILABLE: отсутствует entrypoint Plugin ` +
        `'${pluginPackage.descriptor.id}': ${entrypoint}`,
      { cause: error },
    );
  }
  return {
    command: process.execPath,
    args: [entrypoint, ...invocation.args],
  };
}
