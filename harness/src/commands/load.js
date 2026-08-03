import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { changeDir, isArchived, parseWorkPackages, isKebabCase, extractScenarios } from '../lib/change.js';
import { isAnnotatedTag, commitSha, showFile, listTreeFiles } from '../lib/git.js';

/**
 * `sdd load <change-id> --repo <name> --central <path>` — определяет Work
 * Packages этого репозитория **на ревизии Baseline** (не из рабочего
 * дерева central — оно могло уйти вперёд), пишет .sdd/change.yaml, печатает
 * выжимку требований. Отказывается работать, если изменение не найдено, WP
 * для репозитория нет, или Baseline отсутствует (III.12) — все три ошибки
 * планирования.
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
  // Существование каталога в рабочем дереве central проверяем только чтобы
  // дать внятную ошибку до Baseline; дальше всё читается через `git show`
  // на ревизии тега, не из этого каталога.
  if (!existsSync(dir)) {
    const archived = isArchived(central, changeId);
    console.error(`Ошибка: изменение "${changeId}" не найдено${archived ? ' среди активных (найдено в архиве)' : ''}.`);
    console.error(`  где:    ${dir}`);
    console.error('  что делать: проверить change-id или дождаться Planning PR');
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
  // Сортировка численная по <N>, не лексикографическая — иначе "v9" оказался
  // бы "больше" "v10".
  const latestTag = baselineTags
    .map((tag) => ({ tag, n: Number(tag.match(baselinePattern)[1]) }))
    .sort((a, b) => a.n - b.n)
    .at(-1).tag;

  if (!isAnnotatedTag(central, latestTag)) {
    console.error(`Ошибка: тег ${latestTag} не аннотированный.`);
    process.exitCode = 1;
    return;
  }
  // Ревизия коммита, а не SHA объекта аннотированного тега.
  const revision = commitSha(central, latestTag);

  const changeDirRel = path.join('openspec', 'changes', changeId).split(path.sep).join('/');
  const tasksText = showFile(central, latestTag, `${changeDirRel}/tasks.md`);
  if (tasksText === null) {
    console.error(`Ошибка: tasks.md отсутствует на ревизии Baseline "${latestTag}".`);
    console.error(`  где:    ${changeDirRel}/tasks.md @ ${latestTag}`);
    console.error('  что делать: убедиться, что Baseline создан после того, как tasks.md попал в central');
    process.exitCode = 1;
    return;
  }

  const allPackages = parseWorkPackages(tasksText);
  if (allPackages.length === 0) {
    console.error('Ошибка: tasks.md на ревизии Baseline пуст или не содержит блока work_packages.');
    console.error(`  где:    ${changeDirRel}/tasks.md @ ${latestTag}`);
    console.error('  что делать: заполнить блок work_packages по templates/tasks.schema.md и пересоздать Baseline');
    process.exitCode = 1;
    return;
  }

  // Все пакеты этого репозитория — не только первый найденный. Карточка
  // изменения (III.12) хранит work_packages списком не просто так.
  const myPackages = allPackages.filter((p) => p.repo === repo);
  if (myPackages.length === 0) {
    console.error(`Ошибка: для репозитория "${repo}" нет Work Package в изменении "${changeId}".`);
    console.error(`  где:    ${changeDirRel}/tasks.md @ ${latestTag}`);
    console.error('  что делать: проверить, что репозиторий действительно затронут; если да — добавить Work Package в Planning PR');
    process.exitCode = 1;
    return;
  }
  const incomplete = myPackages.filter((p) => !p.id || !p.type);
  if (incomplete.length > 0) {
    console.error(`Ошибка: Work Package для "${repo}" не заполнен полностью (нужны id и type).`);
    console.error(`  где:    ${changeDirRel}/tasks.md @ ${latestTag}`);
    console.error('  что делать: заполнить id и type по templates/tasks.schema.md');
    process.exitCode = 1;
    return;
  }

  const changeYaml = {
    change_id: changeId,
    store_id: 'project-specs',
    spec_baseline: latestTag,
    spec_revision: revision,
    repository: repo,
    work_packages: myPackages.map((p) => p.id),
    scenario_ids: myPackages.flatMap((p) => p.scenarioIds),
  };

  const sddDir = path.join(targetPath, '.sdd');
  mkdirSync(sddDir, { recursive: true });
  writeFileSync(path.join(sddDir, 'change.yaml'), yaml.dump(changeYaml, { lineWidth: 100 }));

  console.log(`Карточка изменения записана: ${path.join(sddDir, 'change.yaml')}`);
  console.log(`Baseline: ${latestTag} @ ${revision}`);
  console.log('');

  const implementsPackages = myPackages.filter((p) => p.type === 'implements');
  const enablesPackages = myPackages.filter((p) => p.type === 'enables');
  // Зависимые implements-пакеты берутся из ВСЕГО изменения, а не только из
  // Work Packages текущего репозитория — enables в "configuration" зависит
  // от implements в "ui"/"backend", не от самого себя.
  const allImplementsPackages = allPackages.filter((p) => p.type === 'implements');

  if (implementsPackages.length > 0) {
    const scenarioIds = implementsPackages.flatMap((p) => p.scenarioIds);
    if (scenarioIds.length === 0) {
      console.log('Work Package: implements — Scenario ID не указаны (ошибка правила 3, sdd check --change это отловит).');
    } else {
      const specDir = `${changeDirRel}/specs`;
      const specFiles = listTreeFiles(central, latestTag, specDir).map((filePath) => ({
        path: filePath,
        content: showFile(central, latestTag, filePath),
      }));
      const scenarios = extractScenarios(specFiles, scenarioIds);
      for (const scenarioId of scenarioIds) {
        const found = scenarios.get(scenarioId);
        console.log(`--- Scenario: ${scenarioId} ---`);
        if (found) {
          console.log(`(${found.file})`);
          console.log(found.text);
        } else {
          console.log(`НЕ НАЙДЕН в specs/ на ревизии Baseline — проверить tasks.md и Delta Specs`);
        }
        console.log('');
      }
    }
  }

  for (const pkg of enablesPackages) {
    console.log(`Work Package: ${pkg.id} (enables)`);
    console.log(`AC-*: ${pkg.acIds.join(', ') || '(не указаны — ошибка правила 3)'}`);
    // "Условие готовности" и "зависимые пакеты" — раздел 2 плана подготовки
    // Pilot Core, День 4. Регламент не даёт формального алгоритма; принятое
    // здесь решение: готовность = выполнены AC этого пакета И реализованы
    // implements-пакеты того же изменения, от которых, по построению,
    // зависит защитный критерий (I.16.2 — критерий формулируется для
    // implements-репозиториев, enables его технически обеспечивает).
    const dependentIds = allImplementsPackages.map((p) => p.id);
    console.log(
      `Условие готовности: все AC (${pkg.acIds.join(', ') || 'нет'}) подтверждены, и реализованы зависимые Work Packages: ${dependentIds.join(', ') || 'нет'}.`,
    );
    console.log(`Зависимые пакеты (implements этого изменения): ${dependentIds.join(', ') || '(нет)'}`);
    console.log('Сценариев нет и не должно быть (I.16.1).');
    console.log('');
  }
}

function listMatchingTags(cwd, pattern) {
  const out = execFileSync('git', ['tag', '--list'], { cwd, encoding: 'utf8' });
  return out.split('\n').filter((t) => pattern.test(t.trim())).map((t) => t.trim());
}
