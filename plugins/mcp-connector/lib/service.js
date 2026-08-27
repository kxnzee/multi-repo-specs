/** @fileoverview Reconciliation of declarative MCP servers with one Agent settings file. */

import { isDeepStrictEqual } from "node:util";

import { CONFIG_PATH, parseMcpConnectorConfig } from "./config.js";

const STATE_VERSION = 1;
const CONTEXT_START = "<!-- openspec-orch:mcp-connector:context:start -->";
const CONTEXT_END = "<!-- openspec-orch:mcp-connector:context:end -->";
const AGENT_TARGETS = Object.freeze({
  claude: Object.freeze({ settings: ".mcp.json", instructions: "CLAUDE.md" }),
  qwen: Object.freeze({ settings: ".qwen/settings.json", instructions: "QWEN.md" }),
  gigacode: Object.freeze({ settings: ".gigacode/settings.json", instructions: "GIGACODE.md" }),
});

/** Завершает операцию стабильной ошибкой MCP Connector. */
function invalid(code, message, options) {
  throw new Error(`MCP_CONNECTOR_${code}: ${message}`, options);
}

/** Проверяет JSON object без массивов. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Возвращает settings/instructions paths поддерживаемого Agent. */
function agentTargets(agentId) {
  const targets = AGENT_TARGETS[agentId];
  if (!targets) invalid("AGENT_UNSUPPORTED", `agent-id '${agentId}' не поддерживается`);
  return targets;
}

/** Разбирает Agent settings без потери неизвестных полей. */
function parseAgentSettings(source, relativePath) {
  if (source === null || !source.trim()) return {};
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    invalid("SETTINGS_INVALID", `${relativePath}: ${error.message}`, { cause: error });
  }
  if (!isRecord(value)) invalid("SETTINGS_INVALID", `${relativePath}: JSON root должен быть object`);
  if (value.mcpServers !== undefined && !isRecord(value.mcpServers)) {
    invalid("SETTINGS_INVALID", `${relativePath}: mcpServers должен быть object`);
  }
  return value;
}

/** Создаёт единственный стабильный managed block из context каждого MCP server. */
function renderContextBlock(contexts) {
  const entries = Object.entries(contexts);
  if (entries.length === 0) return null;
  for (const [serverId, context] of entries) {
    if (context.includes(CONTEXT_START) || context.includes(CONTEXT_END)) {
      invalid("CONTEXT_INVALID", `${serverId}: context содержит служебный marker`);
    }
  }
  return [
    CONTEXT_START,
    "## MCP Connector context",
    "",
    ...entries.flatMap(([serverId, context]) => [
      `### ${serverId}`,
      "",
      context,
      "",
    ]),
    CONTEXT_END,
    "",
  ].join("\n");
}

/** Находит один managed block, сохраняя весь пользовательский текст вокруг него. */
function parseInstructionFile(source, relativePath) {
  const contents = source ?? "";
  const starts = contents.split(CONTEXT_START).length - 1;
  const ends = contents.split(CONTEXT_END).length - 1;
  if (starts === 0 && ends === 0) {
    return Object.freeze({ contents, block: null, before: contents, after: "" });
  }
  if (starts !== 1 || ends !== 1) {
    invalid("CONTEXT_FILE_INVALID", `${relativePath}: ожидается не более одного managed block`);
  }
  const start = contents.indexOf(CONTEXT_START);
  const endStart = contents.indexOf(CONTEXT_END);
  if (start < 0 || endStart <= start) {
    invalid("CONTEXT_FILE_INVALID", `${relativePath}: markers расположены некорректно`);
  }
  let end = endStart + CONTEXT_END.length;
  if (contents.slice(end, end + 2) === "\r\n") end += 2;
  else if (contents[end] === "\n") end += 1;
  return Object.freeze({
    contents,
    block: contents.slice(start, end),
    before: contents.slice(0, start),
    after: contents.slice(end),
  });
}

/** Заменяет или удаляет только managed context block. */
function replaceContextBlock(file, desired) {
  if (file.block !== null) return `${file.before}${desired ?? ""}${file.after}`;
  if (desired === null) return file.contents;
  const separator = file.contents.length > 0 && !file.contents.endsWith("\n") ? "\n" : "";
  return `${file.contents}${separator}${desired}`;
}

/** Проверяет и нормализует Plugin-owned state. */
function normalizeState(value) {
  if (value === null) return Object.freeze({ version: STATE_VERSION, agents: Object.freeze({}) });
  if (!isRecord(value) || value.version !== STATE_VERSION || !isRecord(value.agents)) {
    invalid("STATE_INVALID", "ожидается versioned agents object");
  }
  if (Object.keys(value).some((key) => !["version", "agents"].includes(key))) {
    invalid("STATE_INVALID", "state содержит неизвестные поля");
  }
  const agents = {};
  for (const [agentId, agentState] of Object.entries(value.agents)) {
    if (
      !isRecord(agentState) ||
      !isRecord(agentState.servers) ||
      Object.keys(agentState).some((key) => !["context", "servers"].includes(key)) ||
      Object.values(agentState.servers).some((server) => !isRecord(server)) ||
      (agentState.context !== undefined && agentState.context !== null && (
        typeof agentState.context !== "string" || agentState.context.length === 0
      ))
    ) {
      invalid("STATE_INVALID", `agents.${agentId} должен содержать servers и optional context`);
    }
    agents[agentId] = Object.freeze({
      servers: Object.freeze({ ...agentState.servers }),
      context: agentState.context ?? null,
    });
  }
  return Object.freeze({ version: STATE_VERSION, agents: Object.freeze(agents) });
}

/** Возвращает новый state с exact ownership выбранного Agent. */
function nextState(current, agentId, desired, context) {
  const agents = { ...current.agents };
  if (Object.keys(desired).length === 0 && context === null) delete agents[agentId];
  else agents[agentId] = { servers: desired, context };
  return { version: STATE_VERSION, agents };
}

/** Стабильно сериализует Agent settings. */
function serializeSettings(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Immutable application result без раскрытия MCP settings и secrets. */
function applyResult(agentId, targets, changes, contextAction) {
  return Object.freeze({
    agentId,
    settingsPath: targets.settings,
    instructionsPath: targets.instructions,
    context: contextAction,
    installed: Object.freeze(changes.installed.sort()),
    updated: Object.freeze(changes.updated.sort()),
    removed: Object.freeze(changes.removed.sort()),
    adopted: Object.freeze(changes.adopted.sort()),
    unchanged: Object.freeze(changes.unchanged.sort()),
  });
}

/** Проверяет ownership managed context и вычисляет безопасную замену. */
function reconcileContext(file, previous, desired) {
  if (
    file.block !== null &&
    file.block !== previous &&
    file.block !== desired
  ) {
    invalid(
      previous === null ? "CONTEXT_CONFLICT" : "CONTEXT_MODIFIED",
      "managed context block изменён вне MCP Connector",
    );
  }
  let action;
  if (desired === null) action = previous === null ? "unconfigured" : "removed";
  else if (file.block === null) action = "installed";
  else if (previous === null) action = "adopted";
  else if (previous === desired) action = "unchanged";
  else action = "updated";
  return Object.freeze({
    action,
    contents: replaceContextBlock(file, desired),
  });
}

/** Возвращает фактический status managed context без раскрытия его содержимого. */
function contextStatus(file, previous, desired) {
  if (previous === null && desired === null) return file.block === null ? "unconfigured" : "unmanaged";
  if (
    previous !== null &&
    file.block !== null &&
    file.block !== previous &&
    file.block !== desired
  ) return "modified";
  if (desired !== null && file.block === null) return "missing";
  if (desired !== null && file.block !== desired) return "outdated";
  if (desired !== null) return previous === null ? "unmanaged" : "ready";
  if (previous !== null && file.block !== null) return "obsolete";
  return "stale_state";
}

/** Reconciler одного Store Agent поверх Core files/storage facades. */
export class McpConnectorService {
  #agentId;
  #files;
  #storage;

  constructor(context) {
    if (
      typeof context?.agent?.id !== "string" ||
      typeof context?.files?.read !== "function" ||
      typeof context?.files?.write !== "function" ||
      typeof context?.storage?.read !== "function" ||
      typeof context?.storage?.write !== "function"
    ) {
      invalid("CONTEXT_INVALID", "требуются Agent, files и storage facades");
    }
    this.#agentId = context.agent.id;
    this.#files = context.files;
    this.#storage = context.storage;
    Object.freeze(this);
  }

  /** Применяет desired MCP entries и удаляет больше не объявленные owned entries. */
  async apply() {
    const state = normalizeState(await this.#storage.read());
    const agentState = state.agents[this.#agentId];
    const previous = agentState?.servers ?? {};
    const previousContext = agentState?.context ?? null;
    const configSource = await this.#files.read(CONFIG_PATH, { optional: true });
    if (
      configSource === null &&
      (Object.keys(previous).length > 0 || previousContext !== null)
    ) {
      invalid(
        "CONFIG_MISSING",
        `${CONFIG_PATH} отсутствует, но Connector уже управляет MCP entries`,
      );
    }
    const config = configSource === null ? null : parseMcpConnectorConfig(configSource);
    const desired = config === null ? Object.freeze({}) : config.forAgent(this.#agentId);
    const desiredContext = renderContextBlock(
      config === null ? Object.freeze({}) : config.contextsForAgent(this.#agentId),
    );
    const targets = agentTargets(this.#agentId);
    if (
      Object.keys(previous).length === 0 &&
      Object.keys(desired).length === 0 &&
      previousContext === null &&
      desiredContext === null
    ) {
      return applyResult(this.#agentId, targets, {
        installed: [], updated: [], removed: [], adopted: [], unchanged: [],
      }, "unconfigured");
    }
    const source = await this.#files.read(targets.settings, { optional: true });
    const settings = parseAgentSettings(source, targets.settings);
    const actual = settings.mcpServers ?? {};
    const nextServers = { ...actual };
    const changes = { installed: [], updated: [], removed: [], adopted: [], unchanged: [] };

    for (const [serverId, expected] of Object.entries(previous)) {
      const present = Object.hasOwn(actual, serverId);
      const target = desired[serverId];
      if (
        present &&
        !isDeepStrictEqual(actual[serverId], expected) &&
        !(target && isDeepStrictEqual(actual[serverId], target))
      ) {
        invalid("ENTRY_MODIFIED", `${serverId} изменён вне MCP Connector`);
      }
      if (!Object.hasOwn(desired, serverId)) {
        if (present) delete nextServers[serverId];
        changes.removed.push(serverId);
      }
    }

    for (const [serverId, definition] of Object.entries(desired)) {
      const managed = Object.hasOwn(previous, serverId);
      const present = Object.hasOwn(actual, serverId);
      if (!managed && present && !isDeepStrictEqual(actual[serverId], definition)) {
        invalid("ENTRY_CONFLICT", `${serverId} уже существует и не принадлежит MCP Connector`);
      }
      if (!present) changes.installed.push(serverId);
      else if (!managed) changes.adopted.push(serverId);
      else if (isDeepStrictEqual(actual[serverId], definition)) changes.unchanged.push(serverId);
      else changes.updated.push(serverId);
      nextServers[serverId] = definition;
    }

    const instructionSource = await this.#files.read(targets.instructions, { optional: true });
    const instructionFile = parseInstructionFile(instructionSource, targets.instructions);
    const contextChange = reconcileContext(
      instructionFile,
      previousContext,
      desiredContext,
    );
    const nextSettings = { ...settings, mcpServers: nextServers };
    if (!isDeepStrictEqual(settings, nextSettings)) {
      await this.#files.write(targets.settings, serializeSettings(nextSettings));
    }
    if (instructionFile.contents !== contextChange.contents) {
      await this.#files.write(targets.instructions, contextChange.contents);
    }
    const updatedState = nextState(state, this.#agentId, desired, desiredContext);
    if (!isDeepStrictEqual(state, updatedState)) await this.#storage.write(updatedState);
    return applyResult(this.#agentId, targets, changes, contextChange.action);
  }

  /** Удаляет все MCP entries, которыми Connector владеет для текущего Agent. */
  async remove() {
    const state = normalizeState(await this.#storage.read());
    const agentState = state.agents[this.#agentId];
    const previous = agentState?.servers ?? {};
    const previousContext = agentState?.context ?? null;
    const targets = agentTargets(this.#agentId);
    if (Object.keys(previous).length === 0 && previousContext === null) {
      return Object.freeze({
        agentId: this.#agentId,
        settingsPath: targets.settings,
        instructionsPath: targets.instructions,
        context: "unconfigured",
        removed: Object.freeze([]),
      });
    }
    const source = await this.#files.read(targets.settings, { optional: true });
    const settings = parseAgentSettings(source, targets.settings);
    const actual = settings.mcpServers ?? {};
    const nextServers = { ...actual };
    const removed = [];
    for (const [serverId, expected] of Object.entries(previous)) {
      if (!Object.hasOwn(actual, serverId)) continue;
      if (!isDeepStrictEqual(actual[serverId], expected)) {
        invalid("ENTRY_MODIFIED", `${serverId} изменён вне MCP Connector`);
      }
      delete nextServers[serverId];
      removed.push(serverId);
    }
    const instructionSource = await this.#files.read(targets.instructions, { optional: true });
    const instructionFile = parseInstructionFile(instructionSource, targets.instructions);
    const contextChange = reconcileContext(instructionFile, previousContext, null);
    const nextSettings = { ...settings, mcpServers: nextServers };
    if (!isDeepStrictEqual(settings, nextSettings)) {
      await this.#files.write(targets.settings, serializeSettings(nextSettings));
    }
    if (instructionFile.contents !== contextChange.contents) {
      await this.#files.write(targets.instructions, contextChange.contents);
    }
    await this.#storage.write(nextState(state, this.#agentId, {}, null));
    return Object.freeze({
      agentId: this.#agentId,
      settingsPath: targets.settings,
      instructionsPath: targets.instructions,
      context: contextChange.action,
      removed: Object.freeze(removed.sort()),
    });
  }

  /** Возвращает read-only reconciliation report без MCP settings payload. */
  async status() {
    const state = normalizeState(await this.#storage.read());
    const agentState = state.agents[this.#agentId];
    const previous = agentState?.servers ?? {};
    const previousContext = agentState?.context ?? null;
    const configSource = await this.#files.read(CONFIG_PATH, { optional: true });
    const config = configSource === null ? null : parseMcpConnectorConfig(configSource);
    const desired = config === null ? {} : config.forAgent(this.#agentId);
    const desiredContext = renderContextBlock(
      config === null ? Object.freeze({}) : config.contextsForAgent(this.#agentId),
    );
    const targets = agentTargets(this.#agentId);
    const source = await this.#files.read(targets.settings, { optional: true });
    const settings = parseAgentSettings(source, targets.settings);
    const actual = settings.mcpServers ?? {};
    const serverIds = [...new Set([...Object.keys(previous), ...Object.keys(desired)])].sort();
    const servers = serverIds.map((serverId) => {
      const managed = Object.hasOwn(previous, serverId);
      const configured = Object.hasOwn(desired, serverId);
      const present = Object.hasOwn(actual, serverId);
      let status;
      if (managed && present && !isDeepStrictEqual(actual[serverId], previous[serverId])) {
        status = "modified";
      } else if (configured && !present) {
        status = "missing";
      } else if (configured && present && !isDeepStrictEqual(actual[serverId], desired[serverId])) {
        status = "outdated";
      } else if (configured && present) {
        status = managed ? "ready" : "unmanaged";
      } else if (managed && present) {
        status = "obsolete";
      } else {
        status = "stale_state";
      }
      return Object.freeze({ id: serverId, status });
    });
    const instructionSource = await this.#files.read(targets.instructions, { optional: true });
    const instructionFile = parseInstructionFile(instructionSource, targets.instructions);
    const context = contextStatus(instructionFile, previousContext, desiredContext);
    const attention = servers.some(({ status }) => status !== "ready") ||
      !["ready", "unconfigured"].includes(context);
    return Object.freeze({
      agentId: this.#agentId,
      configPath: CONFIG_PATH,
      configPresent: configSource !== null,
      settingsPath: targets.settings,
      instructionsPath: targets.instructions,
      context,
      state: configSource === null && serverIds.length === 0 && context === "unconfigured"
        ? "unconfigured"
        : attention ? "attention" : "ready",
      servers: Object.freeze(servers),
    });
  }
}
