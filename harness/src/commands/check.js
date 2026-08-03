import { existsSync } from 'node:fs';
import path from 'node:path';
import { Report } from '../lib/report.js';
import { listMarkdownFilesRecursive, collectAllSpecFiles, collectScenarioIds, scenarioPrefix } from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';

// Ориентир из плана подготовки Pilot Core, раздел /sdd-context: файл
// контекст-пака — экранная страница, порядка 40-60 строк. Порог здесь —
// верхняя граница ориентира, не блокирующий лимит: превышение — предупреждение.
const CONTEXT_FILE_LINE_LIMIT = 60;

/**
 * `sdd check --context [--central <path>]` — область `--context` из III.12.
 * Объём файлов контекст-пака (`openspec/context/*.md`, без `_raw/` — черновики
 * не нормативны и в ориентир не считаются). Не блокирует ничего: предупреждения,
 * которые команда `/sdd-context` показывает пользователю перед финалом.
 */
export function checkContext({ central = process.cwd() } = {}) {
  const report = new Report();
  const contextDir = path.join(central, 'openspec', 'context');

  if (!existsSync(contextDir)) {
    report.warn('context: directory missing', 'каталог openspec/context/ не найден', contextDir, 'запустить /sdd-context, чтобы собрать контекст-пак');
    report.print();
    return report;
  }

  const files = listMarkdownFilesRecursive(contextDir).filter(
    (f) => !path.relative(contextDir, f).startsWith(`_raw${path.sep}`),
  );

  if (files.length === 0) {
    report.warn('context: empty', 'в openspec/context/ нет ни одного .md файла (кроме _raw/)', contextDir, 'запустить /sdd-context, чтобы собрать контекст-пак');
  }

  for (const filePath of files) {
    const content = readFileIfExists(filePath) ?? '';
    const lineCount = content.split('\n').length;
    if (lineCount > CONTEXT_FILE_LINE_LIMIT) {
      report.warn(
        'context: file size',
        `${lineCount} строк — больше ориентира (${CONTEXT_FILE_LINE_LIMIT})`,
        path.relative(central, filePath),
        'вынести подробности отдельным файлом со ссылкой, а не расширять этот',
      );
    }
  }

  report.print();
  return report;
}

/**
 * `sdd check --ids [--prefix <PREFIX>] [--central <path>]` — область `--ids`
 * из III.12 (сквозная уникальность Scenario ID, I.7.4). Читает Master Specs
 * плюс specs/ всех АКТИВНЫХ изменений (архив уже применён к Master Specs).
 *
 * Без `--prefix`: находит дублирующиеся Scenario ID по всему проекту —
 * блокирует, потому что дубликат по I.7.4 — реальная ошибка, не совет.
 * С `--prefix`: сообщает, занят ли префикс, и где — для реестра префиксов
 * (раздел 7 профиля Pilot Core), не блокирует: занятость чужим префиксом
 * решает человек, не эта команда.
 */
export function checkIds({ central = process.cwd(), prefix } = {}) {
  const report = new Report();
  const files = collectAllSpecFiles(central);

  const idLocations = new Map();
  for (const { path: filePath, content } of files) {
    for (const id of collectScenarioIds(content)) {
      const locations = idLocations.get(id) ?? [];
      locations.push(path.relative(central, filePath));
      idLocations.set(id, locations);
    }
  }

  for (const [id, locations] of idLocations) {
    if (locations.length > 1) {
      report.blocking(
        'ids: scenario id uniqueness',
        `Scenario ID "${id}" встречается больше одного раза по проекту (Master Specs + активные изменения)`,
        locations.join(', '),
        'присвоить дублирующему сценарию новый идентификатор из реестра области (I.7.4)',
      );
    }
  }

  if (prefix) {
    const occupied = [...idLocations.keys()].filter((id) => scenarioPrefix(id) === prefix);
    if (occupied.length > 0) {
      const locations = [...new Set(occupied.flatMap((id) => idLocations.get(id)))];
      report.warn(
        'ids: prefix occupancy',
        `Префикс "${prefix}" уже используется (${occupied.length} Scenario ID: ${occupied.slice(0, 5).join(', ')}${occupied.length > 5 ? ', …' : ''})`,
        locations.join(', '),
        'выбрать другой префикс или подтвердить, что это та же область',
      );
    } else {
      console.log(`Префикс "${prefix}" свободен — не встречается ни в одном Scenario ID по проекту.`);
    }
  }

  report.print();
  return report;
}
