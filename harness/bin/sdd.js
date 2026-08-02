#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { setup } from '../src/commands/setup.js';
import { fetchRepos } from '../src/commands/fetch-repos.js';
import { load } from '../src/commands/load.js';
import { checkChange, checkCode } from '../src/commands/check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();
program.name('sdd').description('Утилиты обвязки SDD/OpenSpec — Pilot Core').version(pkg.version);

program
  .command('setup')
  .description('Проверка подключения к центральному репозиторию')
  .action(() => setup({}));

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

const check = program.command('check').description('Блокирующие проверки (правила 1, 4, 5)');

check
  .command('change')
  .description('Правило 1 — структура изменения и Work Packages')
  .argument('<change-id>')
  .option('--central <path>', 'путь к central-репозиторию', process.cwd())
  .action((changeId, opts) => {
    const report = checkChange({ changeId, central: opts.central });
    process.exitCode = report.hasBlocking ? 1 : 0;
  });

check
  .command('code')
  .description('Правила 4, 5 — карточка изменения (сверяется с central) и отсутствие своего OpenSpec-корня')
  .option('--path <path>', 'путь к кодовому репозиторию', process.cwd())
  .option('--central <path>', 'путь к central-репозиторию — без него Baseline не проверить (fail closed)')
  .option('--central-branch <name>', 'основная ветка central, если origin/HEAD не настроен')
  .action((opts) => {
    const report = checkCode({ repoPath: opts.path, central: opts.central, centralBranchOverride: opts.centralBranch });
    process.exitCode = report.hasBlocking ? 1 : 0;
  });

program.parse();
