import { existsSync } from 'node:fs';
import path from 'node:path';
import { Report } from '../lib/report.js';
import {
  changeDir,
  REQUIRED_ARTIFACTS,
  REQUIRED_DESIGN_SECTIONS,
  isKebabCase,
  parseWorkPackages,
} from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';
import { tagExists, isAnnotatedTag, isTagReachableFromBranch, currentBranch } from '../lib/git.js';

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
  if (impactText) {
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

  const tasksText = readFileIfExists(path.join(dir, 'tasks.md'));
  if (tasksText) {
    const packages = parseWorkPackages(tasksText);
    if (packages.length === 0) {
      report.blocking('rule-3: work packages', 'в tasks.md не найдено ни одного Work Package', path.join(dir, 'tasks.md'), 'добавить Work Package для каждого затронутого репозитория (формат: "### <repo> — implements|enables")');
    }
    for (const pkg of packages) {
      if (pkg.type === 'implements' && pkg.scenarioIds.length === 0) {
        report.blocking(
          'rule-3: implements needs scenarios',
          `Work Package "${pkg.repo}" (implements) не связан ни с одним Scenario ID`,
          path.join(dir, 'tasks.md'),
          'добавить "Scenario IDs: <ID1>, <ID2>" в блок пакета (I.16.1)',
        );
      }
      if (pkg.type === 'enables') {
        if (pkg.scenarioIds.length > 0) {
          report.blocking(
            'rule-3: enables must not have scenarios',
            `Work Package "${pkg.repo}" (enables) содержит Scenario ID — не должен (I.16.1)`,
            path.join(dir, 'tasks.md'),
            'убрать Scenario IDs из блока enables',
          );
        }
        if (pkg.acIds.length === 0) {
          report.blocking(
            'rule-3: enables needs AC',
            `Work Package "${pkg.repo}" (enables) не связан ни с одним AC-*`,
            path.join(dir, 'tasks.md'),
            'добавить "AC: <AC-ID>" в блок пакета',
          );
        }
      }
    }
  }

  report.print();
  return report;
}

/**
 * `sdd check --code --path <repo>` — правила 4 и 5 (раздел 4 профиля Pilot Core).
 */
export function checkCode({ repoPath = process.cwd(), skipOwnRootCheck = false }) {
  const report = new Report();
  const cardPath = path.join(repoPath, '.sdd', 'change.yaml');
  const cardText = readFileIfExists(cardPath);

  if (!cardText) {
    report.blocking('rule-4: change card', 'карточка изменения .sdd/change.yaml отсутствует', cardPath, 'запустить `sdd load <change-id> --repo <name>` в этом репозитории');
    report.print();
    return report;
  }

  const fields = ['change_id', 'spec_baseline', 'spec_revision', 'repository', 'work_packages'];
  for (const field of fields) {
    if (!cardText.includes(`${field}:`)) {
      report.blocking('rule-4: change card fields', `в карточке отсутствует поле "${field}"`, cardPath, 'пересоздать карточку через `sdd load`, не редактировать вручную');
    }
  }

  const tagMatch = cardText.match(/spec_baseline:\s*(\S+)/);
  const tag = tagMatch ? tagMatch[1] : null;
  if (tag) {
    if (!/^spec-baseline\/[a-z0-9-]+\/v\d+$/.test(tag)) {
      report.blocking('rule-4: tag name pattern', `имя тега "${tag}" не соответствует шаблону spec-baseline/<change-id>/v<N>`, cardPath, 'пересоздать Baseline командой `sdd baseline`');
    }
    if (!tagExists(repoPath, tag)) {
      report.blocking('rule-4: tag exists', `тег "${tag}" не найден в этом репозитории`, repoPath, 'подтянуть теги (`git fetch --tags`) или проверить корректность Baseline');
    } else {
      if (!isAnnotatedTag(repoPath, tag)) {
        report.blocking('rule-4: annotated tag', `тег "${tag}" не аннотированный`, repoPath, 'пересоздать Baseline аннотированным тегом');
      }
      const branch = currentBranch(repoPath);
      if (!isTagReachableFromBranch(repoPath, tag, branch)) {
        report.blocking('rule-4: tag reachable', `коммит тега "${tag}" не достижим из ветки "${branch}"`, repoPath, 'проверить, что Baseline создан от актуальной основной ветки');
      }
    }
  }

  if (!skipOwnRootCheck) {
    const ownOpenspec = path.join(repoPath, 'openspec', 'config.yaml');
    if (existsSync(ownOpenspec)) {
      report.blocking(
        'rule-5: no own OpenSpec root',
        'в кодовом репозитории найден собственный корень OpenSpec (openspec/config.yaml)',
        ownOpenspec,
        'удалить локальный корень OpenSpec — требования живут только в project-specs',
      );
    }
  }

  report.print();
  return report;
}
