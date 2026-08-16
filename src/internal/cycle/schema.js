/** @fileoverview Zod-схема Cycle Record Alpha v1. */

import * as z from "zod";

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(1),
  cycle_id: z.string().min(1),
  change_id: z.string().min(1),
  planning_revision: z.string().regex(/^[0-9a-f]{40}$/, "должна быть полной lowercase SHA-1 ревизией"),
  repositories: z.array(z.string().min(1)).min(1),
  created_at: z.string().min(1),
});

/**
 * Проверяет строгую схему Cycle Record Alpha v1.
 *
 * @param {unknown} value Разобранный JSON.
 * @returns {Record<string, unknown>} Проверенный документ.
 */
export function parseCycleRecordSchema(value) {
  const result = CYCLE_RECORD_SCHEMA.safeParse(value);
  if (!result.success) throw new Error(`Некорректный Cycle Record: ${z.prettifyError(result.error)}`);
  return result.data;
}
