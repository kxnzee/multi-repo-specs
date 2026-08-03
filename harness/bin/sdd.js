#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { setup } from '../src/commands/setup.js';
import { fetchRepos } from '../src/commands/fetch-repos.js';
import { load } from '../src/commands/load.js';
import { checkChange, checkCode, checkContext, checkIds } from '../src/commands/check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();
program.name('sdd').description('Утилиты обвязки SDD/OpenSpec — Pilot Core').version(pkg.version);

program
  .command('setup')
  .description('Проверка подключения к центральному репозиторию')
  .option('--registry-path <path>', 'путь к реестру хранилищ sdd (по умолчанию ~/.sdd/registry.json)')
  .action((opts) => setup({ registryPath: opts.registryPath }));

program
  .command('fetch-repos')
  .description('Чтение репозиториев-кандидатов из candidate_repositories')
  .requiredOption('--change <change-id>', 'идентификатор изменения')
  .action((opts) => {
    const reposConfigPath = path.join(process.cwd(), 'harness', 'repos.yaml');
    let reposConfig = {};
    try {
      reposConfig = yaml.load(readFileSync(reposConfigPath, 'utf8')) || {};
    } catch {
      reposConfig = {};
    }
    fetchRepos({ change: opts.change, reposConfig });
  });

program
  .command('load')
  .description('Загрузка Work Package и карточки изменения в кодовый репозиторий')
  .argument('<change-id>')
  .requiredOption('--repo <name>', 'имя репозитория, как в tasks.md')
  .option('--central <path>', 'путь к central-репозиторию', process.cwd())
  .option('--path <path>', 'путь к целевому (кодовому) репозиторию', process.cwd())
  .action((changeId, opts) => {
    load({ changeId, repo: opts.repo, central: opts.central, targetPath: opts.path });
  });

// III.12: "Область задаётся явно, а не угадывается по каталогу: --change,
// --code, --ids, --context." Одна команда `sdd check`, область — флаг, а не
// подкоманда — так же, как в шаблонах и плане (`sdd check --change`,
// `sdd check --code`). Ровно одна область за вызов.
program
  .command('check')
  .description('Блокирующие и справочные проверки. Область обязательна: --change, --code, --context или --ids')
  .option('--change <change-id>', 'правило 1 — структура изменения и формат Delta Specs')
  .option('--code', 'правила 4, 5 — карточка изменения (сверяется с --central) и отсутствие своего OpenSpec-корня')
  .option('--context', 'объём контекст-пака (openspec/context/*.md) — предупреждения, не блокирует')
  .option('--ids', 'сквозная уникальность Scenario ID (Master Specs + активные изменения); с --prefix — занятость префикса')
  .option('--prefix <prefix>', 'префикс для --ids (например, ROLE)')
  .option('--central <path>', 'путь к central-репозиторию')
  .option('--central-branch <name>', 'основная ветка central, если origin/HEAD не настроен')
  .option('--path <path>', 'путь к кодовому репозиторию (для --code)', process.cwd())
  .action((opts) => {
    const areas = ['change', 'code', 'context', 'ids'].filter((a) => opts[a]);
    if (areas.length > 1) {
      console.error(`Ошибка: указать можно только одну область — выбрано сразу несколько: --${areas.join(', --')}.`);
      process.exitCode = 1;
      return;
    }
    if (opts.change) {
      const report = checkChange({ changeId: opts.change, central: opts.central ?? process.cwd() });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    if (opts.code) {
      const report = checkCode({ repoPath: opts.path, central: opts.central, centralBranchOverride: opts.centralBranch });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    if (opts.context) {
      const report = checkContext({ central: opts.central ?? process.cwd() });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    if (opts.ids) {
      const report = checkIds({ central: opts.central ?? process.cwd(), prefix: opts.prefix });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    console.error('Ошибка: область не задана. Нужно --change, --code, --context или --ids (III.12: область не угадывается).');
    process.exitCode = 1;
  });

program.parse();
