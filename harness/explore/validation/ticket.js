/** @fileoverview Проверка Jira ticket и поиск связанных Changes для Explore. */

import { promises as fs } from "node:fs";
import path from "node:path";

const ARCHIVE_PREFIX = /^\d{4}-\d{2}-\d{2}-(.+)$/;
const TICKET_PATTERN = /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/;

/**
 * Проверяет внешний ticket key, используемый как ID процесса.
 *
 * @param {unknown} ticket Проверяемое значение.
 * @returns {string} Ticket в исходном верхнем регистре.
 */
export function validateTicket(ticket) {
  if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) {
    throw new Error("Ticket key должен иметь формат из двух uppercase alphanumeric частей через дефис, например PAY-412 или TEST1-TEST0");
  }
  return ticket;
}

/**
 * Проверяет принадлежность имени Change указанному ticket.
 *
 * @param {unknown} changeId Имя активного или архивного Change.
 * @param {string} ticket Нормализованный Jira ticket key.
 * @returns {boolean} Совпадает ли Change с ticket без учёта регистра.
 */
function matchesTicket(changeId, ticket) {
  const prefix = ticket.toLowerCase();
  const normalized = String(changeId).toLowerCase();
  return normalized === prefix || normalized.startsWith(`${prefix}-`);
}

/**
 * Находит активные и архивные Changes, уже связанные с ticket.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} ticket Нормализованный Jira ticket key.
 * @param {Array<{name: string}>} activeChanges Активные Changes из OpenSpec.
 * @returns {Promise<{active: string[], archived: string[]}>} Найденные дубли.
 */
export async function findDuplicates(projectRoot, ticket, activeChanges) {
  const active = [];
  for (const change of activeChanges) {
    if (typeof change?.name !== "string" || !change.name) {
      throw new Error("openspec list --changes вернула Change без корректного name");
    }
    if (matchesTicket(change.name, ticket)) active.push(change.name);
  }

  const archived = [];
  const archiveRoot = path.join(projectRoot, "openspec", "changes", "archive");
  let entries = [];
  try {
    entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlink внутри openspec/changes/archive не поддерживается: ${entry.name}`);
    }
    if (!entry.isDirectory()) continue;
    const changeId = entry.name.match(ARCHIVE_PREFIX)?.[1] ?? entry.name;
    if (matchesTicket(changeId, ticket)) archived.push(entry.name);
  }
  return { active, archived };
}
