/** @fileoverview Shared reverse-order compensation for partially completed operations. */

/** Rolls completed values back in reverse order, preserving both failures when rollback fails. */
export async function rollbackOrRethrow(error, completed, rollback, message) {
  try {
    for (const value of [...completed].reverse()) await rollback(value);
  } catch (cause) {
    throw new AggregateError([error, cause], message, { cause: error });
  }
  throw error;
}
