import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { changeDir, readImpactAndDesign, parseCandidateRepositories } from '../lib/change.js';
import { isClean, revParse, clone } from '../lib/git.js';

const CLONES_DIR_NAME = '.sdd-clones';

/**
 * `sdd fetch-repos --change <id>` — читает candidate_repositories из черновика
 * impact-and-design.md, клонирует read-only, ведёт read-log.md.
 * Восемь гарантий — раздел 7 профиля Pilot Core.
 */
export function fetchRepos({ change, cwd = process.cwd(), reposConfig }) {
  if (!change) {
    console.error('Ошибка: не указан --change <change-id>.');
    process.exitCode = 1;
    return;
  }

  const dir = changeDir(cwd, change);
  const impactText = readImpactAndDesign(cwd, change);
  if (impactText === null) {
    console.error('Ошибка: не найден impact-and-design.md.');
    console.error(`  что:    нет файла impact-and-design.md для изменения "${change}"`);
    console.error(`  где:    ${path.join(dir, 'impact-and-design.md')}`);
    console.error('  что делать: создать черновик с полем candidate_repositories перед вызовом fetch-repos');
    process.exitCode = 1;
    return;
  }

  const candidates = parseCandidateRepositories(impactText);
  if (candidates === null) {
    console.error('Ошибка: поле candidate_repositories не найдено или некорректно.');
    console.error('  что:    в impact-and-design.md нет валидного YAML-блока с candidate_repositories');
    console.error(`  где:    ${path.join(dir, 'impact-and-design.md')}`);
    console.error('  что делать: добавить блок ```yaml\\ncandidate_repositories: [ui, backend]\\n```');
    process.exitCode = 1;
    return;
  }

  if (candidates.length === 0) {
    console.log('candidate_repositories пуст — читать нечего.');
    return;
  }

  // Гарантия: список — только из черновика влияния, не из аргументов команды.
  console.log(`Кандидаты (из candidate_repositories): ${candidates.join(', ')}`);

  const clonesRoot = path.join(cwd, CLONES_DIR_NAME, change);
  mkdirSync(clonesRoot, { recursive: true });
  ensureGitignored(cwd, CLONES_DIR_NAME);

  const readLogPath = path.join(dir, 'read-log.md');
  const header = `# Read Log — ${change}\n\nОбновлено: ${new Date().toISOString()}\n\n`;
  writeFileSync(readLogPath, header);

  let hadFailure = false;
  for (const repoName of candidates) {
    const dest = path.join(clonesRoot, repoName);
    const url = reposConfig?.[repoName];

    // Гарантия: клон одноразовый и чистый — грязный клон пересоздаётся.
    if (existsSync(dest) && !isClean(dest)) {
      rmSync(dest, { recursive: true, force: true });
    }

    if (!existsSync(dest)) {
      if (!url) {
        console.error(`[FAIL] ${repoName}: нет адреса в конфигурации repos (harness/repos.yaml).`);
        console.error('  что делать: добавить репозиторий в harness/repos.yaml с полем url перед повторным запуском');
        appendFileSync(readLogPath, `${repoName} — ОШИБКА: нет адреса в harness/repos.yaml\n\n`);
        hadFailure = true;
        continue;
      }
      try {
        clone(url, dest);
      } catch (err) {
        console.error(`[FAIL] ${repoName}: клонирование не удалось (${err.message.split('\n')[0]}).`);
        appendFileSync(readLogPath, `${repoName} — ОШИБКА: клонирование не удалось\n\n`);
        hadFailure = true;
        continue;
      }
    }

    const revision = revParse(dest);
    const date = new Date().toISOString().slice(0, 10);
    appendFileSync(
      readLogPath,
      `${repoName} @ ${revision}, ${date}\nНайденные ограничения:\n  Новых ограничений не обнаружено.\n\n`,
    );
    console.log(`[OK] ${repoName} @ ${revision}`);
  }

  console.log(`Read log: ${readLogPath}`);
  if (hadFailure) {
    console.error('Одно или несколько чтений не удались — см. read-log.md.');
    process.exitCode = 1;
  }
}

function ensureGitignored(cwd, entry) {
  const gitignorePath = path.join(cwd, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!existing.split('\n').includes(entry)) {
    writeFileSync(gitignorePath, existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + entry + '\n');
  }
}
