#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContext, checkIds } from '../src/commands/check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();
program.name('sdd').description('Утилиты обвязки SDD/OpenSpec — Pilot Core').version(pkg.version);

// III.12: "Область задаётся явно, а не угадывается по каталогу: --change,
// --code, --ids, --context." Эта поставка реализует только --context и
// --ids — обвязку, нужную команде /sdd-context. --change, --code, setup,
// fetch-repos, load — отдельная задача (см. harness/README.md).
program
  .command('check')
  .description('Справочные проверки для /sdd-context. Область обязательна: --context или --ids')
  .option('--context', 'объём контекст-пака (openspec/context/*.md) — предупреждения, не блокирует')
  .option('--ids', 'сквозная уникальность Scenario ID (Master Specs + активные изменения); с --prefix — занятость префикса')
  .option('--prefix <prefix>', 'префикс для --ids (например, ROLE)')
  .option('--central <path>', 'путь к central-репозиторию', process.cwd())
  .action((opts) => {
    const areas = ['context', 'ids'].filter((a) => opts[a]);
    if (areas.length > 1) {
      console.error(`Ошибка: указать можно только одну область — выбрано сразу несколько: --${areas.join(', --')}.`);
      process.exitCode = 1;
      return;
    }
    if (opts.context) {
      const report = checkContext({ central: opts.central });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    if (opts.ids) {
      const report = checkIds({ central: opts.central, prefix: opts.prefix });
      process.exitCode = report.hasBlocking ? 1 : 0;
      return;
    }
    console.error('Ошибка: область не задана. Нужно --context или --ids (III.12: область не угадывается). --change/--code/etc. — отдельная задача.');
    process.exitCode = 1;
  });

program.parse();
