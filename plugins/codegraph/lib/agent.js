/** @fileoverview Provider-specific MCP installation owned by CodeGraph Plugin. */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ADAPTERS = Object.freeze({
  claude: Object.freeze({ mcpConfig: ".mcp.json", instructions: "CLAUDE.md" }),
  qwen: Object.freeze({ mcpConfig: ".qwen/settings.json", instructions: "QWEN.md" }),
  gigacode: Object.freeze({ mcpConfig: ".gigacode/settings.json", instructions: "GIGACODE.md" }),
});
const ENTRYPOINT = fileURLToPath(new URL("../bin/codegraph.js", import.meta.url));
const INSTRUCTIONS = fileURLToPath(new URL("../instructions.md", import.meta.url));
const SERVER_NAME = "openspec-orch-codegraph";
const INSTRUCTION_MARKERS = Object.freeze({
  start: "<!-- OPENSPEC_ORCH_PLUGIN_CODEGRAPH_START -->",
  end: "<!-- OPENSPEC_ORCH_PLUGIN_CODEGRAPH_END -->",
});

/** Проверяет JSON object без массивов. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Возвращает adapter либо стабильную ошибку неподдерживаемого Agent. */
function requireAdapter(agentId) {
  const adapter = ADAPTERS[agentId];
  if (!adapter) {
    throw new Error(`CODEGRAPH_AGENT_UNSUPPORTED: agent-id '${agentId}' не поддерживается`);
  }
  return adapter;
}

/** Возвращает состояние пути, не считая отсутствие ошибкой. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Проверяет отсутствие symlink во всех существующих компонентах project path. */
async function resolveProjectPath(root, relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`CODEGRAPH_AGENT_CONFIG_UNSAFE: ${relativePath} содержит symlink`);
    }
  }
  return target;
}

/** Безопасно читает необязательный project-local Agent file. */
async function readOptionalFile(root, relativePath) {
  const target = await resolveProjectPath(root, relativePath);
  const stat = await lstatOrNull(target);
  if (!stat) return { target, source: "" };
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`CODEGRAPH_AGENT_CONFIG_UNSAFE: ${relativePath} должен быть обычным файлом`);
  }
  return { target, source: await fs.readFile(target, "utf8") };
}

/** Атомарно сохраняет Agent file. */
async function writeAtomic(target, source) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Добавляет либо заменяет один marker-fenced block. */
function replaceMarkedBlock(source, markers, block) {
  const startIndex = source.indexOf(markers.start);
  const endIndex = source.indexOf(markers.end);
  if ((startIndex === -1) !== (endIndex === -1) || source.indexOf(markers.start, startIndex + 1) !== -1) {
    throw new Error(`CODEGRAPH_AGENT_CONFIG_INVALID: повреждён marker ${markers.start}`);
  }
  if (startIndex === -1) {
    const prefix = source.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
  }
  if (endIndex < startIndex) {
    throw new Error(`CODEGRAPH_AGENT_CONFIG_INVALID: повреждён marker ${markers.start}`);
  }
  return `${source.slice(0, startIndex)}${block}${source.slice(endIndex + markers.end.length)}`;
}

/** Удаляет один marker-fenced block. */
function removeMarkedBlock(source, markers) {
  const startIndex = source.indexOf(markers.start);
  const endIndex = source.indexOf(markers.end);
  if (startIndex === -1 && endIndex === -1) return source;
  if (startIndex === -1 || endIndex < startIndex) {
    throw new Error(`CODEGRAPH_AGENT_CONFIG_INVALID: повреждён marker ${markers.start}`);
  }
  const before = source.slice(0, startIndex).trimEnd();
  const tail = source.slice(endIndex + markers.end.length).trimStart();
  return `${before}${before && tail ? "\n\n" : ""}${tail}${before || tail ? "\n" : ""}`;
}

/** Возвращает portable stdio MCP launch spec для bundled CodeGraph. */
function mcpServer(root) {
  return {
    command: process.execPath,
    args: [ENTRYPOINT, "serve", "--mcp"],
    cwd: root,
  };
}

/** Объединяет CodeGraph server с существующим JSON config. */
function installJsonServer(source, server) {
  let value = {};
  if (source.trim()) {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`CODEGRAPH_AGENT_CONFIG_INVALID: ${error.message}`, { cause: error });
    }
  }
  if (!isRecord(value)) throw new Error("CODEGRAPH_AGENT_CONFIG_INVALID: JSON root должен быть object");
  const servers = value.mcpServers ?? {};
  if (!isRecord(servers)) {
    throw new Error("CODEGRAPH_AGENT_CONFIG_INVALID: mcpServers должен быть object");
  }
  if (isDeepStrictEqual(servers[SERVER_NAME], server)) return source;
  return `${JSON.stringify({
    ...value,
    mcpServers: { ...servers, [SERVER_NAME]: server },
  }, null, 2)}\n`;
}

/** Удаляет только CodeGraph server из JSON config. */
function removeJsonServer(source) {
  if (!source.trim()) return source;
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`CODEGRAPH_AGENT_CONFIG_INVALID: ${error.message}`, { cause: error });
  }
  if (!isRecord(value) || !isRecord(value.mcpServers) || !(SERVER_NAME in value.mcpServers)) {
    return source;
  }
  const servers = { ...value.mcpServers };
  delete servers[SERVER_NAME];
  const next = { ...value, mcpServers: servers };
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** Устанавливает либо удаляет MCP entry одного Agent. */
async function updateMcp(root, adapter, remove) {
  const { target, source } = await readOptionalFile(root, adapter.mcpConfig);
  const server = mcpServer(root);
  const next = remove ? removeJsonServer(source) : installJsonServer(source, server);
  if (next !== source) await writeAtomic(target, next);
}

/** Устанавливает либо удаляет CodeGraph instructions одного Agent. */
async function updateInstructions(root, adapter, remove) {
  const { target, source } = await readOptionalFile(root, adapter.instructions);
  const instructions = remove ? "" : (await fs.readFile(INSTRUCTIONS, "utf8")).trim();
  const block = `${INSTRUCTION_MARKERS.start}\n${instructions}\n${INSTRUCTION_MARKERS.end}`;
  const next = remove
    ? removeMarkedBlock(source, INSTRUCTION_MARKERS)
    : replaceMarkedBlock(source, INSTRUCTION_MARKERS, block);
  if (next !== source) await writeAtomic(target, next);
}

/** Устанавливает CodeGraph MCP и инструкции для одного зарегистрированного Agent. */
export async function installAgentIntegration(agentId, projectRoot = process.cwd()) {
  const root = await fs.realpath(projectRoot);
  const adapter = requireAdapter(agentId);
  await updateMcp(root, adapter, false);
  await updateInstructions(root, adapter, false);
}

/** Удаляет принадлежащие CodeGraph MCP entry и инструкции одного Agent. */
export async function removeAgentIntegration(agentId, projectRoot = process.cwd()) {
  const root = await fs.realpath(projectRoot);
  const adapter = requireAdapter(agentId);
  await updateMcp(root, adapter, true);
  await updateInstructions(root, adapter, true);
}
