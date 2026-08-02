import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { changeDir, isArchived, parseWorkPackages, isKebabCase } from '../lib/change.js';
import { readFileIfExists } from '../lib/fs-util.js';
import { isAnnotatedTag, revParse } from '../lib/git.js';

/**
 * `sdd load <change-id> --repo <name> --central <path>` — определяет Work
 * Package этого репозитория, пишет .sdd/change.yaml, печатает выжимку.
 * Отказывается работать, если изменение не найдено, WP для репозитория нет,
 * или Baseline отсутствует (III.12) — все три ошибки планирования.
 */
export function load({ changeId, repo, central = process.cwd(), targetPath = process.cwd() }) {
  if (!changeId || !repo) {
    console.error('Ошибка: нужны <change-id> и --repo <name>.');
    process.exitCode = 1;
    return;
  }

  if (!isKebabCase(changeId)) {
    console.error(`Ошибка: change-id "${changeId}" не в нижнем регистре kebab-case.`);
    process.exitCode = 1;
    return;
  }

  const dir = changeDir(central, changeId);
  if (!existsSync(dir)) {
    const archived = isArchived(central, changeId);
    console.error(`Ошибка: изменение "${changeId}" не найдено${archived ? ' среди активных (найдено в архиве)' : ''}.`);
    console.error(`  где:    ${dir}`);
    console.error('  что делать: проверить change-id или дождаться Planning PR');
    process.exitCode = 1;
    return;
  }

  const tasksText = readFileIfExists(path.join(dir, 'tasks.md'));
  if (tasksText === null) {
    console.error('Ошибка: tasks.md отсутствует — Work Packages не определены.');
    process.exitCode = 1;
    return;
  }

  const packages = parseWorkPackages(tasksText);
  if (packages.length === 0) {
    console.error('Ошибка: tasks.md пуст или не содержит блока work_packages.');
    console.error(`  где:    ${path.join(dir, 'tasks.md')}`);
    console.error('  что делать: заполнить блок work_packages по templates/tasks.schema.md');
    process.exitCode = 1;
    return;
  }
  const myPackage = packages.find((p) => p.repo === repo);
  if (!myPackage) {
    console.error(`Ошибка: для репозитория "${repo}" нет Work Package в изменении "${changeId}".`);
    console.error(`  где:    ${path.join(dir, 'tasks.md')}`);
    console.error('  что делать: проверить, что репозиторий действительно затронут; если да — добавить Work Package в Planning PR');
    process.exitCode = 1;
    return;
  }
  if (!myPackage.id || !myPackage.type) {
    console.error(`Ошибка: Work Package для "${repo}" не заполнен полностью (нужны id и type).`);
    console.error(`  где:    ${path.join(dir, 'tasks.md')}`);
    console.error('  что делать: заполнить id и type по templates/tasks.schema.md');
    process.exitCode = 1;
    return;
  }

  const baselinePattern = new RegExp(`^spec-baseline/${changeId}/v(\\d+)$`);
  const baselineTags = listMatchingTags(central, baselinePattern);
  if (baselineTags.length === 0) {
    console.error(`Ошибка: Baseline для "${changeId}" не найден.`);
    console.error(`  что:    нет тега spec-baseline/${changeId}/v<N>`);
    console.error(`  где:    ${central}`);
    console.error('  что делать: дождаться `sdd baseline` в центральном репозитории, затем повторить `sdd load`');
    process.exitCode = 1;
    return;
  }
  const latestTag = baselineTags.sort().at(-1);
  if (!isAnnotatedTag(central, latestTag)) {
    console.error(`Ошибка: тег ${latestTag} не аннотированный.`);
    process.exitCode = 1;
    return;
  }
  const revision = revParse(central, latestTag);

  const changeYaml = {
    change_id: changeId,
    store_id: 'project-specs',
    spec_baseline: latestTag,
    spec_revision: revision,
    repository: repo,
    work_packages: [myPackage.id],
    scenario_ids: myPackage.scenarioIds,
  };

  const sddDir = path.join(targetPath, '.sdd');
  mkdirSync(sddDir, { recursive: true });
  writeFileSync(path.join(sddDir, 'change.yaml'), yaml.dump(changeYaml, { lineWidth: 100 }));

  console.log(`Карточка изменения записана: ${path.join(sddDir, 'change.yaml')}`);
  console.log(`Baseline: ${latestTag} @ ${revision}`);
  console.log('');

  if (myPackage.type === 'implements') {
    console.log(`Work Package: implements`);
    console.log(`Scenario ID: ${myPackage.scenarioIds.join(', ') || '(не указаны — ошибка правила 3)'}`);
  } else {
    console.log(`Work Package: enables`);
    console.log(`AC-*: ${myPackage.acIds.join(', ') || '(не указаны — ошибка правила 3)'}`);
    console.log('Сценариев нет и не должно быть (I.16.1).');
  }
}

function listMatchingTags(cwd, pattern) {
  const out = execFileSync('git', ['tag', '--list'], { cwd, encoding: 'utf8' });
  return out.split('\n').filter((t) => pattern.test(t.trim())).map((t) => t.trim());
}
