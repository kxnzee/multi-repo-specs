import { existsSync } from 'node:fs';
import path from 'node:path';
import { Report } from '../lib/report.js';
import {
  changeDir,
  REQUIRED_ARTIFACTS,
  REQUIRED_DESIGN_SECTIONS,
  isKebabCase,
  parseWorkPackages,
  isArchived,
  listActiveChanges,
} from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';
import { tagExists, isAnnotatedTag, isTagReachableFromBranch, defaultBranch, revParse } from '../lib/git.js';

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

  const tasksText = readFileIfExists(path.join(dir, 'tasks.md'));
  if (tasksText !== null) {
    const packages = parseWorkPackages(tasksText);
    if (packages.length === 0) {
      report.blocking(
        'rule-3: work packages',
        'в tasks.md не найдено ни одного Work Package',
        path.join(dir, 'tasks.md'),
        'добавить блок work_packages по формату templates/tasks.schema.md',
      );
    }
    for (const pkg of packages) {
      const label = pkg.id ?? pkg.repo ?? '(без id)';
      if (!pkg.id || !pkg.repo || !pkg.type) {
        report.blocking(
          'rule-3: work package fields',
          `Work Package "${label}" не заполнен полностью (нужны id, repository, type)`,
          path.join(dir, 'tasks.md'),
          'заполнить id, repository и type по templates/tasks.schema.md',
        );
        continue;
      }
      if (pkg.type === 'implements' && pkg.scenarioIds.length === 0) {
        report.blocking(
          'rule-3: implements needs scenarios',
          `Work Package "${pkg.id}" (${pkg.repo}, implements) не связан ни с одним Scenario ID`,
          path.join(dir, 'tasks.md'),
          'добавить scenario_ids в блок пакета (I.16.1)',
        );
      }
      if (pkg.type === 'enables') {
        if (pkg.scenarioIds.length > 0) {
          report.blocking(
            'rule-3: enables must not have scenarios',
            `Work Package "${pkg.id}" (${pkg.repo}, enables) содержит scenario_ids — не должен (I.16.1)`,
            path.join(dir, 'tasks.md'),
            'убрать scenario_ids из блока enables',
          );
        }
        if (pkg.acIds.length === 0) {
          report.blocking(
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

  const fields = ['change_id', 'spec_baseline', 'spec_revision', 'repository', 'work_packages'];
  for (const field of fields) {
    if (!cardText.includes(`${field}:`)) {
      report.blocking('rule-4: change card fields', `в карточке отсутствует поле "${field}"`, cardPath, 'пересоздать карточку через `sdd load`, не редактировать вручную');
    }
  }

  const tagMatch = cardText.match(/spec_baseline:\s*(\S+)/);
  const tag = tagMatch ? tagMatch[1] : null;
  const changeIdMatch = cardText.match(/change_id:\s*(\S+)/);
  const changeId = changeIdMatch ? changeIdMatch[1] : null;
  const revisionMatch = cardText.match(/spec_revision:\s*(\S+)/);
  const cardRevision = revisionMatch ? revisionMatch[1] : null;

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

        const actualRevision = revParse(central, tag);
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
