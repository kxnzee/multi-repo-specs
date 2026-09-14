/** @fileoverview Общие helpers нативных Agent Extension adapters поставки. */

import { promises as fs } from "node:fs";
import path from "node:path";

/** Standalone Extension сохраняет ID, Plugin contribution получает owner prefix. */
export function nativeExtensionId(extensionId, ownerId) {
  return ownerId === undefined ? extensionId : `${ownerId}-${extensionId}`;
}

/** Адаптирует upstream OpenSpec pack в Agent-owned target directory. */
export async function adaptOpenSpecPack({ agent, targetRoot }) {
  const source = path.join(targetRoot, agent.generatedDirectory);
  const sourceStat = await fs.lstat(source).catch((cause) => {
    throw new Error(
      `AGENT_PACK_INVALID: ожидается ${agent.generatedDirectory}/ после openspec init`,
      { cause },
    );
  });
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`AGENT_PACK_INVALID: ${agent.generatedDirectory}/ должен быть directory без symlink`);
  }
  if (agent.generatedDirectory === agent.targetDirectory) return;
  const destination = path.join(targetRoot, agent.targetDirectory);
  const destinationStat = await fs.lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (destinationStat) {
    throw new Error(`AGENT_PACK_INVALID: уже существует ${agent.targetDirectory}/`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
}

/** Требует обычный manifest без перехода по symlink. */
export async function requireNativeManifest(manifest, extensionRoot) {
  const relative = path.relative(extensionRoot, manifest);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`AGENT_EXTENSION_INVALID: manifest выходит из Extension root: ${manifest}`);
  }
  let current = extensionRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((cause) => {
      if (cause.code === "ENOENT") {
        throw new Error(`AGENT_EXTENSION_INVALID: отсутствует ${manifest}`, { cause });
      }
      throw cause;
    });
    if (stat.isSymbolicLink()) {
      throw new Error(`AGENT_EXTENSION_INVALID: manifest не должен проходить через symlink: ${manifest}`);
    }
  }
  if (!(await fs.stat(manifest)).isFile()) {
    throw new Error(`AGENT_EXTENSION_INVALID: ${manifest} должен быть обычным файлом`);
  }
}

/** Читает JSON manifest после проверки обычного файла. */
export async function readNativeManifest(manifest, extensionRoot) {
  await requireNativeManifest(manifest, extensionRoot);
  try {
    return JSON.parse(await fs.readFile(manifest, "utf8"));
  } catch (cause) {
    throw new Error(`AGENT_EXTENSION_INVALID: ${manifest} содержит некорректный JSON`, { cause });
  }
}

/** Запускает native command, сохраняя Extension target и точный argv. */
export async function runNative(context, extension, args) {
  const immutableArgs = Object.freeze([...args]);
  try {
    return await context.process.run(context.agent.executable, immutableArgs);
  } catch (cause) {
    const source = extension.source ?? "plugin-contribution";
    throw new Error(
      `AGENT_EXTENSION_NATIVE_FAILED: agent=${context.agent.id}; extension=${extension.id}; ` +
        `target=${extension.target?.id ?? "unknown"}; scope=${context.agent.scope}; ` +
        `source=${source}; ` +
        `native command: ${JSON.stringify([context.agent.executable, ...immutableArgs])}; ` +
        cause.message,
      { cause },
    );
  }
}

/** Проверяет native CLI выбранного Agent без mutation. */
export async function preflightNative(context) {
  try {
    return await context.process.run(context.agent.executable, Object.freeze(["--version"]));
  } catch (cause) {
    throw new Error(
      `AGENT_PREFLIGHT_FAILED: ${context.agent.id}; native command: ` +
        `${JSON.stringify([context.agent.executable, "--version"])}; ${cause.message}`,
      { cause },
    );
  }
}

/** Compares shipped files with the native installation, including unchanged-version updates. */
export async function assertInstalledPayload(extension, installedRoot) {
  if (typeof installedRoot !== "string" || !path.isAbsolute(installedRoot)) {
    throw new Error(`AGENT_EXTENSION_STATUS_INVALID: ${extension.id}: native CLI did not report an absolute installation path`);
  }
  const expectedRoot = await fs.realpath(extension.root);
  const actualRoot = await fs.realpath(installedRoot).catch((cause) => {
    throw new Error(`AGENT_EXTENSION_STATUS_STALE: ${extension.id}: installation is missing; publish a new native manifest version and reconnect the Extension`, { cause });
  });
  if (expectedRoot === actualRoot) return;
  /** Reads only regular payload files; native installation bookkeeping is not shipped payload. */
  async function compare(relative = "") {
    const entries = await fs.readdir(path.join(expectedRoot, relative), { withFileTypes: true });
    const expectedNames = new Set(entries.map(({ name }) => name));
    for (const name of await fs.readdir(path.join(actualRoot, relative))) {
      if ([".git", "node_modules"].includes(name) || (!relative &&
        [".qwen-extension-install.json", ".gigacode-extension-install.json", ".gemini-extension-install.json"].includes(name))) continue;
      if (!expectedNames.has(name)) throw new Error(`AGENT_EXTENSION_STATUS_STALE: ${extension.id}: removed file ${path.join(relative, name)} remains installed; publish a new native manifest version and reconnect the Extension`);
    }
    for (const entry of entries) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const file = path.join(relative, entry.name);
      const actual = path.join(actualRoot, file);
      const stat = await fs.lstat(actual).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (entry.isSymbolicLink() || stat?.isSymbolicLink() ||
        (entry.isDirectory() ? !stat?.isDirectory() : !entry.isFile() || !stat?.isFile())) {
        throw new Error(`AGENT_EXTENSION_STATUS_STALE: ${extension.id}: ${file}; publish a new native manifest version and reconnect the Extension`);
      }
      if (entry.isDirectory()) await compare(file);
      else if (!(await fs.readFile(path.join(expectedRoot, file))).equals(await fs.readFile(actual))) {
        throw new Error(`AGENT_EXTENSION_STATUS_STALE: ${extension.id}: ${file}; publish a new native manifest version and reconnect the Extension`);
      }
    }
  }
  await compare();
}
