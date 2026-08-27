/** @fileoverview Strict declarative contract of Store-owned MCP Connector configuration. */

import { parse as parseYaml } from "yaml";

export const CONFIG_PATH = "mcp-connector.yaml";
const CONFIG_VERSION = 1;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Завершает разбор стабильной ошибкой конфигурации Connector. */
function invalid(message, options) {
  throw new Error(`MCP_CONNECTOR_CONFIG_INVALID: ${message}`, options);
}

/** Проверяет обычный JSON object без массивов. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Запрещает неизвестные поля декларативного контракта. */
function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) invalid(`${label} содержит неизвестные поля: ${unknown.join(", ")}`);
}

/** Создаёт независимую JSON-копию и отклоняет не-JSON значения. */
function ownJson(value, label) {
  let source;
  try {
    source = JSON.stringify(value);
  } catch (error) {
    invalid(`${label} должен быть JSON-совместимым: ${error.message}`, { cause: error });
  }
  if (source === undefined) invalid(`${label} должен быть JSON-совместимым`);
  return JSON.parse(source);
}

/** Глубоко замораживает принадлежащее Connector JSON-значение. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Immutable декларация одного MCP server. */
class McpServerDefinition {
  #agents;
  #context;
  #id;
  #settings;

  constructor(id, value) {
    if (!ID_PATTERN.test(id)) invalid(`server-id '${id}' должен быть lowercase kebab-case`);
    if (!isRecord(value)) invalid(`servers.${id} должен быть object`);
    assertKnownKeys(value, new Set(["agents", "context", "settings"]), `servers.${id}`);
    if (!isRecord(value.settings) || Object.keys(value.settings).length === 0) {
      invalid(`servers.${id}.settings должен быть непустым object`);
    }
    if (
      value.context !== undefined &&
      (typeof value.context !== "string" || value.context.trim().length === 0)
    ) {
      invalid(`servers.${id}.context должен быть непустой строкой`);
    }
    let agents = null;
    if (value.agents !== undefined) {
      if (
        !Array.isArray(value.agents) ||
        value.agents.length === 0 ||
        value.agents.some((agentId) => typeof agentId !== "string" || !ID_PATTERN.test(agentId)) ||
        new Set(value.agents).size !== value.agents.length
      ) {
        invalid(`servers.${id}.agents должен содержать уникальные Agent ID`);
      }
      agents = Object.freeze([...value.agents]);
    }
    this.#id = id;
    this.#agents = agents;
    this.#context = value.context === undefined ? null : value.context.trim();
    this.#settings = deepFreeze(ownJson(value.settings, `servers.${id}.settings`));
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get context() { return this.#context; }
  get settings() { return this.#settings; }

  supportsAgent(agentId) {
    return this.#agents === null || this.#agents.includes(agentId);
  }
}

/** Immutable проверенная конфигурация MCP Connector. */
export class McpConnectorConfig {
  #servers;

  constructor(servers) {
    if (!Array.isArray(servers) || servers.some((server) => !(server instanceof McpServerDefinition))) {
      invalid("servers должен содержать проверенные MCP declarations");
    }
    this.#servers = Object.freeze([...servers].sort((left, right) => left.id.localeCompare(right.id)));
    Object.freeze(this);
  }

  get servers() { return this.#servers; }

  forAgent(agentId) {
    return Object.freeze(Object.fromEntries(
      this.#servers
        .filter((server) => server.supportsAgent(agentId))
        .map((server) => [server.id, server.settings]),
    ));
  }

  contextsForAgent(agentId) {
    return Object.freeze(Object.fromEntries(
      this.#servers
        .filter((server) => server.supportsAgent(agentId) && server.context !== null)
        .map((server) => [server.id, server.context]),
    ));
  }
}

/** Разбирает обязательный versioned YAML contract. */
export function parseMcpConnectorConfig(source) {
  if (typeof source !== "string") invalid("source должен быть строкой");
  let value;
  try {
    value = parseYaml(source);
  } catch (error) {
    invalid(`некорректный YAML: ${error.message}`, { cause: error });
  }
  if (!isRecord(value)) invalid("корень должен быть YAML object");
  assertKnownKeys(value, new Set(["version", "servers"]), "config");
  if (value.version !== CONFIG_VERSION) invalid(`поддерживается только version: ${CONFIG_VERSION}`);
  if (!isRecord(value.servers)) invalid("servers должен быть object");
  return new McpConnectorConfig(
    Object.entries(value.servers).map(([id, server]) => new McpServerDefinition(id, server)),
  );
}
