import { existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { Report } from '../lib/report.js';
import {
  changeDir,
  REQUIRED_ARTIFACTS,
  REQUIRED_DESIGN_SECTIONS,
  isKebabCase,
  parseWorkPackages,
  isArchived,
  listActiveChanges,
  validateDeltaSpecContent,
  collectScenarioIds,
  listMarkdownFilesRecursive,
  collectAllSpecFiles,
  scenarioPrefix,
} from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';
import { tagExists, isAnnotatedTag, isTagReachableFromBranch, defaultBranch, commitSha } from '../lib/git.js';

/**
 * `sdd check --change <id>` — правило 1: структура изменения и формат
 * требований (раздел 4 профиля Pilot Core).
 */
export function checkChange({ changeId, central = process.cwd() }) {
  const report = new Report();
  const dir = changeDir(central, changeId);

  if (!isKebabCase(changeId)) {
    report.blocking(
      'rule-1: change-id format',
      `change-id "${changeId}" не в нижнем регистре kebab-case`,
      dir,
      'переименовать каталог изменения в формат kebab-case',
    );
  }

  if (!existsSync(dir)) {
    report.blocking('rule-1: change exists', 'каталог изменения не найден', dir, 'проверить change-id или создать Planning PR');
    report.print();
    return report;
  }

  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!existsSync(path.join(dir, artifact))) {
      report.blocking(
        'rule-1: required artifact',
        `отсутствует обязательный артефакт "${artifact}"`,
        path.join(dir, artifact),
        `создать ${artifact} по шаблону раздела 3 профиля Pilot Core`,
      );
    }
  }

  const impactText = readFileIfExists(path.join(dir, 'impact-and-design.md'));
  // Строгое сравнение с null: пустой, но существующий файл ('') не должен
  // молча проходить проверку схемы — это баг, который поймала фикстура.
  if (impactText !== null) {
    for (const section of REQUIRED_DESIGN_SECTIONS) {
      if (!impactText.includes(section)) {
        report.blocking(
          'rule-1: impact-and-design schema',
          `отсутствует секция "${section}"`,
          path.join(dir, 'impact-and-design.md'),
          `добавить секцию ${section} (раздел Design обязателен даже когда пуст)`,
        );
      }
    }
  }

  const specsDir = path.join(dir, 'specs');
  if (existsSync(specsDir)) {
    const specFiles = listMarkdownFilesRecursive(specsDir);
    if (specFiles.length === 0) {
      report.blocking('rule-1: delta specs present', 'каталог specs/ пуст — нет ни одного .md файла', specsDir, 'добавить хотя бы один файл Delta Specs (I.7.5)');
    }
    const scenarioIdLocations = new Map(); // id -> [file, file, ...]
    for (const filePath of specFiles) {
      const content = readFileIfExists(filePath);
      if (content === null) continue;
      const issues = validateDeltaSpecContent(content, path.relative(central, filePath));
      for (const issue of issues) {
        report.blocking('rule-1: delta spec format', issue.what, issue.where, issue.fix);
      }
      for (const id of collectScenarioIds(content)) {
        const locations = scenarioIdLocations.get(id) ?? [];
        locations.push(path.relative(central, filePath));
        scenarioIdLocations.set(id, locations);
      }
    }
    for (const [id, locations] of scenarioIdLocations) {
      if (locations.length > 1) {
        report.blocking(
          'rule-1: scenario id uniqueness',
          `Scenario ID "${id}" встречается больше одного раза в пределах этого изменения`,
          locations.join(', '),
          'присвоить дублирующему сценарию новый идентификатор из реестра области (I.7.4)',
        );
      }
    }
    // Сквозная уникальность (по Master Specs и другим активным изменениям,
    // не только внутри этого) — вне объёма MVP: требует реестра области
    // (I.7.4), которого в Pilot Core пока нет как отдельного артефакта.
  }

  const tasksText = readFileIfExists(path.join(dir, 'tasks.md'));
  if (tasksText !== null) {
    const packages = parseWorkPackages(tasksText);
    if (packages.length === 0) {
      // Правило 3 в Pilot Core исполняется Spec Owner по чек-листу до
      // недели 1-2 пилота (раздел 4 профиля) — здесь предупреждение, не
      // блокировка, до момента, когда III.17 переведёт его в машинное.
      report.warn(
        'rule-3: work packages',
        'в tasks.md не найдено ни одного Work Package',
        path.join(dir, 'tasks.md'),
        'добавить блок work_packages по формату templates/tasks.schema.md',
      );
    }
    for (const pkg of packages) {
      const label = pkg.id ?? pkg.repo ?? '(без id)';
      if (!pkg.id || !pkg.repo || !pkg.type) {
        report.warn(
          'rule-3: work package fields',
          `Work Package "${label}" не заполнен полностью (нужны id, repository, type)`,
          path.join(dir, 'tasks.md'),
          'заполнить id, repository и type по templates/tasks.schema.md',
        );
        continue;
      }
      if (pkg.type === 'implements' && pkg.scenarioIds.length === 0) {
        report.warn(
          'rule-3: implements needs scenarios',
          `Work Package "${pkg.id}" (${pkg.repo}, implements) не связан ни с одним Scenario ID`,
          path.join(dir, 'tasks.md'),
          'добавить scenario_ids в блок пакета (I.16.1)',
        );
      }
      if (pkg.type === 'enables') {
        if (pkg.scenarioIds.length > 0) {
          report.warn(
            'rule-3: enables must not have scenarios',
            `Work Package "${pkg.id}" (${pkg.repo}, enables) содержит scenario_ids — не должен (I.16.1)`,
            path.join(dir, 'tasks.md'),
            'убрать scenario_ids из блока enables',
          );
        }
        if (pkg.acIds.length === 0) {
          report.warn(
            'rule-3: enables needs AC',
            `Work Package "${pkg.id}" (${pkg.repo}, enables) не связан ни с одним AC-*`,
            path.join(dir, 'tasks.md'),
            'добавить ac_ids в блок пакета',
          );
        }
      }
    }
  }

  report.print();
  return report;
}

/**
 * `sdd check --code --path <repo> --central <path>` — правила 4 и 5
 * (раздел 4 профиля Pilot Core).
 *
 * Baseline-тег живёт в центральном репозитории (III.12: `sdd baseline` —
 * "центральный репозиторий"), не в кодовом. Все проверки тега и достижимости
 * поэтому идут против `central`, а не против `repoPath`.
 */
export function checkCode({ repoPath = process.cwd(), central, centralBranchOverride, skipOwnRootCheck = false }) {
  const report = new Report();
  const cardPath = path.join(repoPath, '.sdd', 'change.yaml');
  const cardText = readFileIfExists(cardPath);

  if (!cardText) {
    report.blocking('rule-4: change card', 'карточка изменения .sdd/change.yaml отсутствует', cardPath, 'запустить `sdd load <change-id> --repo <name>` в этом репозитории');
    report.print();
    return report;
  }

  // Разбор через YAML, а не поиском подстроки "field:" — иначе
  // `spec_baseline:` с пустым значением проходит как "поле присутствует".
  let card;
  try {
    card = yaml.load(cardText);
  } catch (err) {
    report.blocking('rule-4: change card parses', `.sdd/change.yaml не парсится как YAML: ${err.message.split('\n')[0]}`, cardPath, 'пересоздать карточку через `sdd load`');
    report.print();
    return report;
  }
  if (!card || typeof card !== 'object') {
    report.blocking('rule-4: change card parses', '.sdd/change.yaml пуст или не является объектом', cardPath, 'пересоздать карточку через `sdd load`');
    report.print();
    return report;
  }

  const fields = ['change_id', 'spec_baseline', 'spec_revision', 'repository', 'work_packages'];
  for (const field of fields) {
    const value = card[field];
    const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (isEmpty) {
      report.blocking('rule-4: change card fields', `в карточке отсутствует или пусто поле "${field}"`, cardPath, 'пересоздать карточку через `sdd load`, не редактировать вручную');
    }
  }

  const tag = typeof card.spec_baseline === 'string' && card.spec_baseline ? card.spec_baseline : null;
  const changeId = typeof card.change_id === 'string' && card.change_id ? card.change_id : null;
  const cardRevision = typeof card.spec_revision === 'string' && card.spec_revision ? card.spec_revision : null;

  if (!central) {
    // Fail closed (III.16): без доступа к центральному репозиторию Baseline
    // не проверить в принципе — молчаливый "пропуск" был бы дефектом.
    report.blocking(
      'rule-4: central repository required',
      'не указан --central <path> — Baseline и его достижимость не проверить без центрального репозитория',
      repoPath,
      'передать --central <путь к клону project-specs>',
    );
  } else {
    if (changeId && !existsSync(changeDir(central, changeId)) && !isArchived(central, changeId)) {
      report.blocking(
        'rule-4: change exists centrally',
        `изменение "${changeId}" не найдено в центральном хранилище — ни среди активных, ни в архиве`,
        central,
        'проверить change_id в карточке или актуальность central-репозитория',
      );
    }

    if (tag) {
      if (!/^spec-baseline\/[a-z0-9-]+\/v\d+$/.test(tag)) {
        report.blocking('rule-4: tag name pattern', `имя тега "${tag}" не соответствует шаблону spec-baseline/<change-id>/v<N>`, cardPath, 'пересоздать Baseline командой `sdd baseline`');
      }
      if (!tagExists(central, tag)) {
        report.blocking('rule-4: tag exists', `тег "${tag}" не найден в центральном репозитории`, central, 'подтянуть теги (`git fetch --tags`) в central или проверить корректность Baseline');
      } else {
        if (!isAnnotatedTag(central, tag)) {
          report.blocking('rule-4: annotated tag', `тег "${tag}" не аннотированный`, central, 'пересоздать Baseline аннотированным тегом');
        }
        const branch = defaultBranch(central, centralBranchOverride);
        if (!branch) {
          report.blocking('rule-4: tag reachable', 'не удалось определить основную ветку central-репозитория', central, 'передать --central-branch явно или настроить origin/HEAD');
        } else if (!isTagReachableFromBranch(central, tag, branch)) {
          report.blocking('rule-4: tag reachable', `коммит тега "${tag}" не достижим из основной ветки "${branch}"`, central, 'проверить, что Baseline создан от актуальной основной ветки');
        }

        const actualRevision = commitSha(central, tag);
        if (cardRevision && cardRevision !== actualRevision) {
          report.blocking(
            'rule-4: revision matches card',
            `spec_revision в карточке ("${cardRevision}") не совпадает с фактической ревизией тега ("${actualRevision}")`,
            cardPath,
            'пересоздать карточку через `sdd load` — не редактировать spec_revision вручную',
          );
        }
      }
    }
  }

  if (!skipOwnRootCheck) {
    // Не только config.yaml — каталог openspec/specs или openspec/changes
    // без config.yaml тоже посторонний корень OpenSpec (кто-то мог удалить
    // или не закоммитить только сам конфиг).
    const candidates = ['config.yaml', 'specs', 'changes'];
    const foundMarkers = candidates.filter((name) => existsSync(path.join(repoPath, 'openspec', name)));
    if (foundMarkers.length > 0) {
      report.blocking(
        'rule-5: no own OpenSpec root',
        `в кодовом репозитории найден собственный корень OpenSpec (openspec/${foundMarkers.join(', openspec/')})`,
        path.join(repoPath, 'openspec'),
        'удалить локальный корень OpenSpec — требования живут только в project-specs',
      );
    }
  }

  report.print();
  return report;
}

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
