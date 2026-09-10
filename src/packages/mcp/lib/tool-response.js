/** @fileoverview Stable MCP encoding for tool values, errors and conditional reads. */

import { createHash } from "node:crypto";

/** Computes a revision of one tool result with its exact input. */
function contextRevision(name, args, value) {
  return createHash("sha256").update(JSON.stringify([name, args, value])).digest("hex");
}

/** Adds a revision without changing public fields of an object result. */
function revisedValue(value, revision) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ...value, context_revision: revision });
  }
  return Object.freeze({ value, context_revision: revision });
}

/** Encodes a domain value into one compact MCP text result. */
export function toolResultContent(value, { args, conditionalRevision, definition } = {}) {
  let result = value;
  if (definition?.tool.annotations.readOnlyHint) {
    const revision = contextRevision(definition.tool.name, args, value);
    result = conditionalRevision === revision
      ? Object.freeze({ unchanged: true, context_revision: revision })
      : revisedValue(value, revision);
  }
  return Object.freeze({
    content: Object.freeze([{ type: "text", text: JSON.stringify(result) }]),
  });
}

/** Encodes an expected tool error without terminating the stdio server. */
export function toolErrorContent(error) {
  return Object.freeze({
    isError: true,
    content: Object.freeze([{
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    }]),
  });
}
