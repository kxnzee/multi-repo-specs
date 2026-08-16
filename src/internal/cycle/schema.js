/** @fileoverview Zod-схема Cycle Record Alpha v1. */

import * as z from "zod";

import { isChangeId, isRepositoryId } from "../shared/schema.js";

const CYCLE_ID_PATTERN = /^cycle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(1),
  cycle_id: z.string().regex(CYCLE_ID_PATTERN, "должен быть в формате cycle-<uuid>"),
  change_id: z.string().refine(isChangeId, "должен быть в lowercase kebab-case"),
  planning_revision: z.string().regex(/^[0-9a-f]{40}$/, "должна быть полной lowercase SHA-1 ревизией"),
  repositories: z.array(z.string().refine(isRepositoryId, "repository-id должен быть в lowercase kebab-case")).min(1),
  created_at: z.string().regex(RFC3339_UTC_PATTERN, "должна быть RFC 3339 UTC датой"),
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
