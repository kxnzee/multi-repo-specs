/** @fileoverview Reusable value parsers for SDK-backed CLI options. */

/** Rejects a repeated scalar option. */
export function singleValue(value, previous) {
  if (previous !== undefined) throw new Error("опцию можно указать только один раз");
  return value;
}

/** Collects one repeatable option without mutating parser state. */
export function collectValues(value, previous = []) {
  return [...previous, value];
}
