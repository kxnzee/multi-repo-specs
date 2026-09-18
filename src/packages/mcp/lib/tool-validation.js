/** @fileoverview Fail-closed validation for MCP tool input beyond JSON Schema. */

export const MCP_IDENTIFIER_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

/** Validates one required or optional non-empty string. */
function assertString(args, field, { required = false, minLength = 1 } = {}) {
  if (args[field] === undefined && !required) return;
  if (typeof args[field] !== "string" || args[field].length < minLength) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть непустой строкой`);
  }
}

/** Validates a canonical Orchestrator/OpenSpec identifier. */
function assertIdentifier(args, field, { required = false } = {}) {
  assertString(args, field, { required });
  if (args[field] !== undefined && !new RegExp(MCP_IDENTIFIER_PATTERN, "u").test(args[field])) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть lowercase kebab-case`);
  }
}

/** Validates scalar fields declared by one MCP JSON Schema. */
function assertDeclaredScalars(name, args, inputSchema) {
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (args[field] === undefined || fieldSchema.type === "string") continue;
    if (fieldSchema.type === "boolean" && typeof args[field] !== "boolean") {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} должен быть логическим значением (boolean)`);
    }
  }
}

/** Validates string fields declared by one MCP JSON Schema. */
function assertDeclaredStrings(name, args, inputSchema) {
  const required = new Set(inputSchema.required ?? []);
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (fieldSchema.type !== "string") continue;
    assertString(args, field, { required: required.has(field), minLength: fieldSchema.minLength ?? 0 });
    if (args[field] === undefined) continue;
    if (fieldSchema.pattern === MCP_IDENTIFIER_PATTERN) {
      assertIdentifier(args, field, { required: required.has(field) });
    }
    if (fieldSchema.enum && !fieldSchema.enum.includes(args[field])) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} неизвестен`);
    }
  }
}

/** Validates a plain object against the fields declared by one MCP JSON Schema. */
function assertObjectShape(name, args, inputSchema) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} аргументы должны быть объектом`);
  }
  const allowed = new Set(Object.keys(inputSchema.properties ?? {}));
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} не принимает ${unknown}`);
  assertDeclaredStrings(name, args, inputSchema);
  assertDeclaredScalars(name, args, inputSchema);
}

/** Validates the nested repository declaration used by initialize_project. */
function assertInitialization(args, inputSchema) {
  if (args.extensions !== undefined) {
    if (!Array.isArray(args.extensions)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: extensions должен быть массивом");
    }
    const seen = new Set();
    for (const extensionId of args.extensions) {
      assertIdentifier({ extension_id: extensionId }, "extension_id", { required: true });
      if (seen.has(extensionId)) {
        throw new Error(`MCP_TOOL_INPUT_INVALID: повторяющийся extension_id ${extensionId}`);
      }
      seen.add(extensionId);
    }
  }
  if (args.repositories === undefined) return;
  if (!Array.isArray(args.repositories)) {
    throw new Error("MCP_TOOL_INPUT_INVALID: repositories должен быть массивом");
  }
  const repositorySchema = inputSchema.properties.repositories.items;
  const repositoryFields = Object.keys(repositorySchema.properties);
  const ids = new Set();
  for (const repository of args.repositories) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository должен быть объектом");
    }
    const keys = Object.keys(repository);
    if (keys.some((key) => !repositoryFields.includes(key))) {
      throw new Error("MCP_TOOL_INPUT_INVALID: контракт repository несовместим");
    }
    assertObjectShape("repository", repository, repositorySchema);
    if (repository.repository_id === args.store_id) {
      throw new Error(
        `STORE_INCLUDED_AS_CODE: Store уже задан через store_id; удалите ` +
          `${repository.repository_id} из repositories и не меняйте store_id`,
      );
    }
    if (ids.has(repository.repository_id)) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: повторяющийся repository_id ${repository.repository_id}`);
    }
    ids.add(repository.repository_id);
  }
}

/** Validates built-in tool input even when a client ignores published JSON Schema. */
export function assertToolArguments(definition, args) {
  const { tool, validate } = definition;
  assertObjectShape(tool.name, args, tool.inputSchema);
  if (validate) validate(args, tool.inputSchema);
}

export const MCP_TOOL_VALIDATORS = Object.freeze({ assertInitialization });
