import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Report } from '../lib/report.js';
import { collectAllSpecFiles, collectScenarioOccurrences, collectSpecFilesAtRef, scenarioPrefix } from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';

// Ориентир из плана подготовки Pilot Core, раздел /sdd-context: файл
// контекст-пака — экранная страница, порядка 40-60 строк. Порог здесь —
// верхняя граница ориентира, не блокирующий лимит: превышение — предупреждение.
const CONTEXT_FILE_LINE_LIMIT = 60;
const REQUIRED_CONTEXT_FILES = [
  '00-start-here.md',
  '02-domain-glossary.md',
  '03-architecture.md',
  'system-map.yaml',
  '09-scenario-prefixes.md',
];

/**
 * `sdd check --context [--central <path>]` — область `--context` из III.12.
 * Объём файлов контекст-пака (`openspec/context/*.{md,yaml}`, без `_raw/` — черновики
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

  for (const name of REQUIRED_CONTEXT_FILES) {
    const requiredPath = path.join(contextDir, name);
    if (!existsSync(requiredPath)) {
      report.warn('context: required file missing', `не найден обязательный файл минимального контекста "${name}"`, requiredPath, 'заполнить файл через /sdd-context или явно оставить TODO с адресатом');
    }
  }

  // Ориентир относится к основным файлам контекст-пака. ADR/, examples/
  // и другие подробности как раз выносятся отдельно и не должны получать
  // повторное предупреждение за объём.
  const files = readdirSync(contextDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yaml')))
    .map((entry) => path.join(contextDir, entry.name));

  if (files.length === 0) {
    report.warn('context: empty', 'в openspec/context/ нет ни одного .md/.yaml файла верхнего уровня', contextDir, 'запустить /sdd-context, чтобы собрать контекст-пак');
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
export function checkIds({ central = process.cwd(), prefix, planningRefs = [] } = {}) {
  const report = new Report();
  const files = collectAllSpecFiles(central);

  if (planningRefs.length === 0) {
    report.warn(
      'ids: planning refs coverage',
      'открытые planning PR не проверены: не передан ни один --planning-ref',
      'аргументы команды',
      'передать каждую открытую planning-ветку/PR ref через повторяемый --planning-ref; в CI refs предварительно fetch-нуть',
    );
  } else {
    const known = new Set(
      files
        .filter((file) => file.kind === 'delta')
        .map((file) => `${path.relative(central, file.path)}\0${file.content}`),
    );
    for (const ref of [...new Set(planningRefs)]) {
      try {
        for (const file of collectSpecFilesAtRef(central, ref)) {
          const key = `${file.path}\0${file.content}`;
          if (known.has(key)) continue;
          known.add(key);
          files.push(file);
        }
      } catch (error) {
        report.blocking(
          'ids: planning ref unavailable',
          `не удалось прочитать planning ref "${ref}"`,
          ref,
          'проверить имя ref и предварительно получить его командой git fetch',
        );
      }
    }
  }

  const masterLocations = new Map();
  const deltaFiles = [];
  for (const file of files) {
    if (file.kind === 'master') {
      for (const { id } of collectScenarioOccurrences(file.content)) {
        const locations = masterLocations.get(id) ?? [];
        locations.push(path.relative(central, file.path));
        masterLocations.set(id, locations);
      }
    } else {
      deltaFiles.push(file);
    }
  }

  // В глобальный набор попадают Master IDs и только действительно новые IDs
  // из дельт. Сценарий MODIFIED, уже существующий в Master Spec, — та же
  // сущность, а не дубликат (I.7.4/I.7.5).
  const idLocations = new Map([...masterLocations].map(([id, locations]) => [id, [...locations]]));
  for (const { path: filePath, content, ref } of deltaFiles) {
    const relativePath = ref ? `${ref}:${filePath}` : path.relative(central, filePath);
    const occurrences = collectScenarioOccurrences(content);
    const seenInFile = new Set();
    for (const { id, operation } of occurrences) {
      if (seenInFile.has(id)) {
        const locations = idLocations.get(id) ?? [];
        locations.push(relativePath);
        idLocations.set(id, locations);
        continue;
      }
      seenInFile.add(id);
      const carriedByModified = operation === 'modified' && masterLocations.has(id);
      if (!carriedByModified) {
        const locations = idLocations.get(id) ?? [];
        locations.push(relativePath);
        idLocations.set(id, locations);
      }
    }
  }

  for (const [id, locations] of idLocations) {
    if (locations.length > 1) {
      report.blocking(
        'ids: scenario id uniqueness',
        `Scenario ID "${id}" встречается больше одного раза по проекту (Master Specs + активные изменения + переданные planning refs)`,
        locations.join(', '),
        'присвоить дублирующему сценарию новый идентификатор из реестра области (I.7.4)',
      );
    }
  }

  if (prefix) {
    const normalizedPrefix = normalizePrefix(prefix);
    if (!normalizedPrefix) {
      report.blocking('ids: prefix format', `Префикс "${prefix}" не соответствует формату: 1–8 символов A–Z/0–9, первый символ — буква`, 'аргумент --prefix', 'передать префикс без завершающего дефиса, например ROLE');
      report.print();
      return report;
    }

    const occupiedIds = [...idLocations.keys()].filter((id) => scenarioPrefix(id) === normalizedPrefix);
    const registryPath = path.join(central, 'openspec', 'context', '09-scenario-prefixes.md');
    const registeredPrefixes = readRegisteredPrefixes(registryPath);
    const registered = registeredPrefixes.has(normalizedPrefix);
    if (occupiedIds.length > 0 || registered) {
      const locations = [...new Set(occupiedIds.flatMap((id) => idLocations.get(id)))];
      if (registered) locations.unshift(path.relative(central, registryPath));
      report.warn(
        'ids: prefix occupancy',
        `Префикс "${normalizedPrefix}" уже зарегистрирован или используется (${occupiedIds.length} Scenario ID${occupiedIds.length ? `: ${occupiedIds.slice(0, 5).join(', ')}${occupiedIds.length > 5 ? ', …' : ''}` : ''})`,
        locations.join(', '),
        'выбрать другой префикс или подтвердить, что это та же область',
      );
    } else {
      console.log(`Префикс "${normalizedPrefix}" свободен — не зарегистрирован и не встречается ни в одном Scenario ID по проекту.`);
    }
  }

  report.print();
  return report;
}

function normalizePrefix(value) {
  const normalized = String(value).trim().toUpperCase().replace(/-+$/, '');
  return /^[A-Z][A-Z0-9]{0,7}$/.test(normalized) ? normalized : null;
}

function readRegisteredPrefixes(registryPath) {
  const content = readFileIfExists(registryPath);
  const result = new Set();
  if (!content) return result;
  for (const line of content.split('\n')) {
    const match = /^\|\s*`?([A-Za-z][A-Za-z0-9-]*)`?\s*\|/.exec(line);
    if (!match) continue;
    const normalized = normalizePrefix(match[1]);
    if (normalized && normalized !== 'PREFIX') result.add(normalized);
  }
  return result;
}
