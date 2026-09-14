/** @fileoverview Shared reverse-order compensation for partially completed operations. */

/** Attempts every compensation and preserves the original and all rollback failures. */
export async function rollbackOrRethrow(error, completed, rollback, message) {
  const failures = [];
  for (const value of [...completed].reverse()) {
    try {
      await rollback(value);
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError([error, ...failures], message, { cause: error });
  }
  throw error;
}
