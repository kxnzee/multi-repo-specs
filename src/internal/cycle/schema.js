/** @fileoverview Zod-схема Cycle Record Alpha v1. */

import * as z from "zod";

import { isChangeId, isRepositoryId } from "../shared/schema.js";

const UUID_V4_SCHEMA = z.uuidv4();

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(1),
  cycle_id: z.string().refine(
    (value) => value.startsWith("cycle-") && UUID_V4_SCHEMA.safeParse(value.slice("cycle-".length)).success,
    "должен быть в формате cycle-<uuid-v4>",
  ),
  change_id: z.string().refine(isChangeId, "должен быть в lowercase kebab-case"),
  planning_revision: z.string().regex(/^[0-9a-f]{40}$/, "должна быть полной lowercase SHA-1 ревизией"),
  repositories: z.array(z.string().refine(isRepositoryId, "repository-id должен быть в lowercase kebab-case")).min(1),
  created_at: z.iso.datetime({ offset: false }),
});

/**
 * Проверяет строгую схему Cycle Record Alpha v1.
 *
 * @param {unknown} value Разобранный JSON.
 * @returns {Record<string, unknown>} Проверенный документ.
 */
export function parseCycleRecordSchema(value) {
  const result = CYCLE_RECORD_SCHEMA.safeParse(value);
  if (!result.success) throw new Error(`STATE_CORRUPTED: Некорректный Cycle Record: ${z.prettifyError(result.error)}`);
  return result.data;
}
