/** @fileoverview Проверка и нормализация входного Plugin definition. */

import {
  DEFINITION_ID_PATTERN,
  REPOSITORY_ROLES,
  assertKnownKeys,
  assertPlainObject,
} from "./validation.js";

const PLUGIN_KEYS = new Set(["agent", "id", "supports", "repository", "extensions", "registerCommands"]);
const REPOSITORY_KEYS = new Set(["connect", "status", "sync", "exec"]);
const AGENT_KEYS = new Set(["create", "enhance", "requireBinding", "tools", "operations"]);
const AGENT_TOOL_KEYS = new Set([
  "annotations", "description", "execute", "inputSchema", "name", "validate", "repositoryScoped", "repositoryParameter",
]);
const AGENT_TOOL_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

/** Завершает проверку Plugin definition стабильной ошибкой SDK. */
export function invalidPluginDefinition(message) {
  throw new Error(`PLUGIN_DEFINITION_INVALID: ${message}`);
}

const assertPlainDefinitionObject = (value, label) => (
  assertPlainObject(value, label, invalidPluginDefinition)
);
const assertKnownDefinitionKeys = (value, allowed, label) => (
  assertKnownKeys(value, allowed, label, invalidPluginDefinition)
);

/** Проверяет callback одного contribution. */
function assertCallback(value, label) {
  if (typeof value !== "function") invalidPluginDefinition(`${label} должен быть функцией`);
}

/** Проверяет и копирует Repository contribution. */
function repositoryContribution(repository) {
  if (repository === undefined) return undefined;
  assertPlainDefinitionObject(repository, "repository");
  assertKnownDefinitionKeys(repository, REPOSITORY_KEYS, "repository");
  assertCallback(repository.connect, "repository.connect");
  assertCallback(repository.status, "repository.status");
  if (repository.sync !== undefined) assertCallback(repository.sync, "repository.sync");
  if (repository.exec !== undefined) assertCallback(repository.exec, "repository.exec");
  return Object.freeze({
    connect: repository.connect,
    status: repository.status,
    ...(repository.sync === undefined ? {} : { sync: repository.sync }),
    ...(repository.exec === undefined ? {} : { exec: repository.exec }),
  });
}

/** Проверяет optional data-only Extension contribution callback. */
function extensionContribution(extensions) {
  if (extensions === undefined) return undefined;
  assertCallback(extensions, "extensions");
  return extensions;
}

/** Copies and freezes Agent tool metadata without introducing a separate domain hierarchy. */
function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, immutable(nested)]),
  ));
}

/** Validates the small data contract used by generic Agent routing. */
function agentContribution(agent) {
  if (agent === undefined) return undefined;
  assertPlainDefinitionObject(agent, "agent");
  assertKnownDefinitionKeys(agent, AGENT_KEYS, "agent");
  assertCallback(agent.create, "agent.create");
  if (agent.enhance !== undefined) assertCallback(agent.enhance, "agent.enhance");
  if (agent.requireBinding !== undefined && typeof agent.requireBinding !== "boolean") {
    invalidPluginDefinition("agent.requireBinding должен быть boolean");
  }
  const operations = agent.operations ?? {};
  assertPlainDefinitionObject(operations, "agent.operations");
  for (const [name, handler] of Object.entries(operations)) {
    if (!AGENT_TOOL_PATTERN.test(name)) invalidPluginDefinition("agent operation name должен быть lowercase snake_case");
    assertCallback(handler, `agent.operations.${name}`);
  }
  if (!Array.isArray(agent.tools ?? [])) invalidPluginDefinition("agent.tools должен быть массивом");
  const tools = (agent.tools ?? []).map((tool) => {
    assertPlainDefinitionObject(tool, "agent tool");
    assertKnownDefinitionKeys(tool, AGENT_TOOL_KEYS, "agent tool");
    if (typeof tool.name !== "string" || !AGENT_TOOL_PATTERN.test(tool.name)) {
      invalidPluginDefinition("agent tool name должен быть lowercase snake_case");
    }
    if (typeof tool.description !== "string" || !tool.description.trim()) {
      invalidPluginDefinition(`agent tool ${tool.name} требует description`);
    }
    assertCallback(tool.execute, `agent tool ${tool.name}.execute`);
    if (tool.validate !== undefined) assertCallback(tool.validate, `agent tool ${tool.name}.validate`);
    if (tool.repositoryScoped !== undefined && typeof tool.repositoryScoped !== "boolean") {
      invalidPluginDefinition(`agent tool ${tool.name}.repositoryScoped должен быть boolean`);
    }
    if (tool.repositoryParameter !== undefined) {
      const parameter = tool.repositoryParameter;
      if (typeof parameter !== "string" || !AGENT_TOOL_PATTERN.test(parameter) ||
          tool.inputSchema?.properties?.[parameter]?.type !== "string") {
        invalidPluginDefinition(`agent tool ${tool.name}.repositoryParameter должен указывать строковое поле inputSchema`);
      }
      if (tool.repositoryScoped !== undefined) {
        invalidPluginDefinition(`agent tool ${tool.name}: используйте только repositoryParameter или repositoryScoped`);
      }
    }
    return Object.freeze({
      repositoryParameter: tool.repositoryParameter ?? (tool.repositoryScoped ? "repository_id" : null),
      repositoryScoped: tool.repositoryScoped ?? false,
      name: tool.name,
      definition: Object.freeze({
        name: tool.name,
        description: tool.description.trim(),
        inputSchema: immutable(tool.inputSchema ?? {}),
        annotations: immutable(tool.annotations ?? {}),
      }),
      validate: tool.validate ?? (() => undefined),
      execute: tool.execute,
    });
  });
  if (new Set(tools.map(({ name }) => name)).size !== tools.length) {
    invalidPluginDefinition("agent.tools содержит повторяющийся name");
  }
  return Object.freeze({
    create: agent.create,
    enhance: agent.enhance ?? (({ result }) => result),
    requireBinding: agent.requireBinding ?? false,
    tools: Object.freeze(tools),
    operations: Object.freeze({ ...operations }),
  });
}

/** Проверяет definition и возвращает его immutable внутреннее представление. */
export function normalizePluginDefinition(definition) {
  assertPlainDefinitionObject(definition, "Plugin definition");
  assertKnownDefinitionKeys(definition, PLUGIN_KEYS, "Plugin definition");
  if (typeof definition.id !== "string" || !DEFINITION_ID_PATTERN.test(definition.id)) {
    invalidPluginDefinition("id должен быть lowercase kebab-case");
  }
  if (definition.supports !== undefined && !Array.isArray(definition.supports)) {
    invalidPluginDefinition("supports должен быть массивом");
  }
  const supports = [...(definition.supports ?? [])];
  if (supports.some((role) => !REPOSITORY_ROLES.has(role))) {
    invalidPluginDefinition("supports содержит неизвестную Repository role");
  }
  if (new Set(supports).size !== supports.length) {
    invalidPluginDefinition("supports содержит повторяющуюся role");
  }
  const repository = repositoryContribution(definition.repository);
  const extensions = extensionContribution(definition.extensions);
  const agent = agentContribution(definition.agent);
  if (repository && supports.length === 0) {
    invalidPluginDefinition("repository contribution требует хотя бы одну supports role");
  }
  if (!repository && supports.length > 0) {
    invalidPluginDefinition("supports разрешён только вместе с repository contribution");
  }
  if (definition.registerCommands !== undefined) {
    assertCallback(definition.registerCommands, "registerCommands");
  }
  if (!repository && !extensions && !agent && definition.registerCommands === undefined) {
    invalidPluginDefinition("Plugin должен объявить хотя бы один contribution");
  }
  return Object.freeze({
    id: definition.id,
    supports: Object.freeze(supports),
    repository,
    agent,
    extensions,
    registerCommands: definition.registerCommands,
  });
}
