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
