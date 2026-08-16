/** @fileoverview Чтение, атомарная запись и кодирование Cycle Record. */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../shared/files.js";
import { parseCycleRecordSchema } from "./schema.js";

const CYCLE_CONTRACT_VERSION = 1;
const CHANGES_DIRECTORY = path.join(".openspec-orch", "changes");

/**
 * Кодирует `change-id` в безопасное имя файла Cycle Record.
 *
 * @param {string} changeId Проверенный change-id.
 * @returns {string} base64url без padding.
 */
export function encodeChangeKey(changeId) {
  return Buffer.from(changeId, "utf8").toString("base64url");
}

/**
 * Возвращает путь Cycle Record относительно корня Store в POSIX-формате.
 *
 * @param {string} changeId Проверенный change-id.
 * @returns {string} Относительный POSIX-путь.
 */
export function cycleRecordRelativePath(changeId) {
  return `.openspec-orch/changes/${encodeChangeKey(changeId)}.json`;
}

/**
 * Возвращает абсолютный путь Cycle Record внутри рабочей копии Store.
 *
 * @param {string} storeRoot Канонический путь Store.
 * @param {string} changeId Проверенный change-id.
 * @returns {string} Абсолютный путь.
 */
export function cycleRecordPath(storeRoot, changeId) {
  return path.join(storeRoot, CHANGES_DIRECTORY, `${encodeChangeKey(changeId)}.json`);
}

/**
 * Нормализует проверенный схемой Cycle Record во внутренний camelCase формат.
 *
 * @param {Record<string, unknown>} value Проверенный документ.
 * @returns {import("./types.js").CycleRecord} Нормализованная запись.
 */
function normalizeCycleRecord(value) {
  return {
    contractVersion: value.contract_version,
    cycleId: value.cycle_id,
    changeId: value.change_id,
    planningRevision: value.planning_revision,
    repositories: value.repositories,
    createdAt: value.created_at,
  };
}

/**
 * Читает и проверяет Cycle Record из рабочей копии Store; отсутствие файла — не ошибка.
 *
 * @param {string} storeRoot Канонический путь Store.
 * @param {string} changeId Проверенный change-id.
 * @returns {Promise<import("./types.js").CycleRecord | null>} Проверенная запись либо `null`.
 */
export async function readCycleRecord(storeRoot, changeId) {
  let source;
  try {
    source = await fs.readFile(cycleRecordPath(storeRoot, changeId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`STATE_CORRUPTED: Cycle Record повреждён (${cycleRecordRelativePath(changeId)}): ${error.message}`);
  }
  const record = normalizeCycleRecord(parseCycleRecordSchema(payload));
  if (record.changeId !== changeId) {
    throw new Error(
      `STATE_CORRUPTED: Cycle Record ${cycleRecordRelativePath(changeId)} содержит change_id ` +
      `'${record.changeId}', ожидался '${changeId}'`,
    );
  }
  return record;
}

/**
 * Проверяет, что Cycle ссылается на уникальные Code Repository текущего реестра.
 *
 * @param {import("./types.js").CycleRecord} record Проверенный файловой схемой Cycle.
 * @param {import("../config/index.js").NormalizedConfig} config Текущая конфигурация Store.
 * @returns {void}
 */
export function assertCycleRepositories(record, config) {
  const unique = new Set(record.repositories);
  if (unique.size !== record.repositories.length) {
    throw new Error("STATE_CORRUPTED: Cycle Record содержит повторяющийся repository-id");
  }
  const knownCodeIds = new Set(config.codeRepositories.map(({ id }) => id));
  for (const repositoryId of record.repositories) {
    if (!knownCodeIds.has(repositoryId)) {
      throw new Error(
        `STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository '${repositoryId}'`,
      );
    }
  }
}

/**
 * Атомарно записывает Cycle Record в рабочую копию Store. Core не коммитит файл.
 *
 * @param {string} storeRoot Канонический путь Store.
 * @param {import("./types.js").CycleRecord} record Проверенная запись.
 * @returns {Promise<string>} Абсолютный путь записанного файла.
 */
export async function writeCycleRecord(storeRoot, record) {
  const target = cycleRecordPath(storeRoot, record.changeId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const payload = {
    contract_version: record.contractVersion,
    cycle_id: record.cycleId,
    change_id: record.changeId,
    planning_revision: record.planningRevision,
    repositories: record.repositories,
    created_at: record.createdAt,
  };
  parseCycleRecordSchema(payload);
  await writeFileAtomic(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

/**
 * Создаёт новый Cycle Record Alpha v1 с уникальным `cycle_id`.
 *
 * @param {{changeId: string, planningRevision: string, repositories: string[]}} input Проверенные входные данные.
 * @returns {import("./types.js").CycleRecord} Новая запись.
 */
export function createCycleRecord({ changeId, planningRevision, repositories }) {
  return {
    contractVersion: CYCLE_CONTRACT_VERSION,
    cycleId: `cycle-${randomUUID()}`,
    changeId,
    planningRevision,
    repositories,
    createdAt: new Date().toISOString(),
  };
}
