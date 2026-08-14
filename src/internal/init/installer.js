/** @fileoverview Preflight и установка рассчитанного Project Template plan. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { pathState } from "./preflight.js";

/**
 * Блокирует занятые до запуска agent-pack paths.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../template/types.js").TemplateAgent} agent Mapping выбранного агента.
 * @returns {Promise<void>}
 */
export async function assertAgentPackPathsAvailable(projectRoot, agent) {
  for (const relativePath of new Set([agent.generatedDirectory, agent.targetDirectory])) {
    if (await pathState(path.join(projectRoot, relativePath))) {
      throw new Error(`Инициализации мешает существующий agent pack: ${relativePath}/`);
    }
  }
}

/**
 * Фиксирует существовавшие до запуска файлы plan и блокирует различающийся контент.
 *
 * @param {import("../template/types.js").TemplatePlanFile[]} files Copy plan.
 * @returns {Promise<Set<string>>} Пути идентичных файлов, которые не нужно менять.
 */
export async function inspectPreExistingTemplateFiles(files) {
  const finalFiles = new Map();
  for (const file of files) finalFiles.set(file.targetRelative, file);
  const unchanged = new Set();
  for (const file of finalFiles.values()) {
    const stat = await pathState(file.target);
    if (!stat) continue;
    const [actual, expected] = await Promise.all([
      fs.readFile(file.target),
      fs.readFile(file.source),
    ]);
    if (!actual.equals(expected)) {
      throw new Error(`Инициализации мешает существующий файл с другим содержимым: ${file.targetRelative}`);
    }
    unchanged.add(file.targetRelative);
  }
  return unchanged;
}

/**
 * Повторно проверяет путь после внешнего OpenSpec init перед записью Template.
 *
 * @param {string} targetRoot Корень Store.
 * @param {string} relativePath Относительный путь назначения.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние конечного пути.
 */
async function inspectWritableTarget(targetRoot, relativePath) {
  let current = targetRoot;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await pathState(current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new Error(`Target содержит symlink: ${relativePath}`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`Target содержит file-directory collision: ${relativePath}`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`Target конфликтует с каталогом или специальным объектом: ${relativePath}`);
    }
    if (final) return stat;
  }
  return null;
}

/**
 * Переносит официальный agent pack в provider-specific каталог из Template mapping.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../template/types.js").TemplateAgent} agent Mapping выбранного агента.
 * @returns {Promise<void>}
 */
export async function adaptGeneratedAgentPack(projectRoot, agent) {
  const source = path.join(projectRoot, agent.generatedDirectory);
  const sourceStat = await pathState(source);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`OpenSpec не создал ожидаемый agent pack ${agent.generatedDirectory}/`);
  }
  if (agent.generatedDirectory === agent.targetDirectory) return;
  const destination = path.join(projectRoot, agent.targetDirectory);
  if (await pathState(destination)) {
    throw new Error(`Нельзя перенести agent pack: уже существует ${agent.targetDirectory}/`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
}

/**
 * Применяет рассчитанный Template plan. Template имеет приоритет над файлами,
 * созданными OpenSpec в рамках текущего запуска.
 *
 * @param {object} options Параметры применения.
 * @param {string} options.projectRoot Корень Store.
 * @param {import("../template/types.js").TemplatePlanFile[]} options.files Copy plan.
 * @param {Set<string>} options.unchangedPreExisting Идентичные пользовательские файлы.
 * @returns {Promise<{created: string[], updated: string[]}>} Изменённые пути.
 */
export async function applyTemplatePlan({ projectRoot, files, unchangedPreExisting }) {
  const created = new Set();
  const updated = new Set();
  for (const file of files) {
    if (unchangedPreExisting.has(file.targetRelative)) continue;
    const targetStat = await inspectWritableTarget(projectRoot, file.targetRelative);
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    await fs.copyFile(file.source, file.target);
    await fs.chmod(file.target, file.mode);
    if (!created.has(file.targetRelative) && !updated.has(file.targetRelative)) {
      if (targetStat) updated.add(file.targetRelative);
      else created.add(file.targetRelative);
    }
  }
  return { created: [...created].sort(), updated: [...updated].sort() };
}
