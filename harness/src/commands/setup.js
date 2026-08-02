import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { findUp } from '../lib/fs-util.js';
import { listActiveChanges } from '../lib/change.js';

const CLI_VERSION = '0.1.0';
export const DEFAULT_REGISTRY_PATH = path.join(os.homedir(), '.sdd', 'registry.json');
// Версия, с которой этот репозиторий был инициализирован
// (npx @fission-ai/openspec@1.7.0 init --tools qwen). "sdd setup" сверяет
// установленный CLI с этим номером, а не просто спрашивает "работает ли".
export const PINNED_OPENSPEC_VERSION = '1.7.0';
export const STORE_ID = 'project-specs';

function runOpenspec(args, cwd, env) {
  return execFileSync('openspec', args, { cwd, env, encoding: 'utf8' });
}

/**
 * `sdd setup` — идемпотентна. Реестр хранилищ (`~/.sdd/registry.json`) —
 * машинное состояние этого инструмента (не в git). Регистрация в самом
 * OpenSpec (через `openspec store register`) — отдельная вещь: то, что
 * реально "проверяет, что требования читаются", III.12.
 */
export function setup({ cwd = process.cwd(), env = process.env, registryPath = DEFAULT_REGISTRY_PATH } = {}) {
  console.log(`sdd ${CLI_VERSION}`);

  const centralRepo = findUp(cwd, path.join('openspec', 'config.yaml'));
  if (!centralRepo) {
    console.error('Ошибка: центральный репозиторий не найден.');
    console.error('  что:    в текущем каталоге и выше нет openspec/config.yaml');
    console.error(`  где:    ${cwd}`);
    console.error('  что делать: запустить внутри клона project-specs, либо `openspec init` ещё не выполнялся');
    process.exitCode = 1;
    return;
  }

  // 1. Наличие CLI зафиксированной версии (III.12).
  let openspecVersion;
  try {
    openspecVersion = runOpenspec(['--version'], centralRepo, env).trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('Ошибка: команда `openspec` не найдена в PATH.');
      console.error(`  что делать: npm install -g @fission-ai/openspec@${PINNED_OPENSPEC_VERSION}`);
      process.exitCode = 1;
      return;
    }
    console.error(`Ошибка: \`openspec --version\` завершился с ошибкой: ${String(err.message).split('\n')[0]}`);
    process.exitCode = 1;
    return;
  }
  if (openspecVersion !== PINNED_OPENSPEC_VERSION) {
    console.error(`Ошибка: установлен openspec ${openspecVersion}, зафиксирована версия ${PINNED_OPENSPEC_VERSION}.`);
    console.error(`  что делать: npm install -g @fission-ai/openspec@${PINNED_OPENSPEC_VERSION}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OpenSpec CLI: ${openspecVersion} (зафиксированная версия)`);

  // 2. Регистрация внешнего Store через сам openspec, не собственный JSON.
  let stores;
  try {
    stores = JSON.parse(runOpenspec(['store', 'list', '--json'], centralRepo, env)).stores ?? [];
  } catch (err) {
    console.error(`Ошибка: \`openspec store list\` завершился с ошибкой: ${String(err.message).split('\n')[0]}`);
    process.exitCode = 1;
    return;
  }
  const alreadyRegistered = stores.some((s) => s.id === STORE_ID && path.resolve(s.root) === path.resolve(centralRepo));
  if (!alreadyRegistered) {
    try {
      runOpenspec(['store', 'register', centralRepo, '--id', STORE_ID, '--yes', '--json'], centralRepo, env);
      console.log(`Хранилище "${STORE_ID}" зарегистрировано в openspec.`);
    } catch (err) {
      console.error(`Ошибка: не удалось зарегистрировать хранилище в openspec: ${String(err.message).split('\n')[0]}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`Хранилище "${STORE_ID}" уже зарегистрировано в openspec.`);
  }

  // 3. Подтверждение содержательного чтения — ответом самого openspec, а не
  // только подсчётом каталогов на диске. "Не отсутствие ошибок, а наличие
  // содержимого" (III.12) означает, что инструмент, которым реально будут
  // пользоваться (`openspec list`), должен вернуть то же самое, что видно
  // из файловой системы — иначе несовпадение и есть находка.
  let specsFromOpenspec;
  let changesFromOpenspec;
  try {
    specsFromOpenspec = JSON.parse(runOpenspec(['list', '--store', STORE_ID, '--specs', '--json'], centralRepo, env)).specs ?? [];
    changesFromOpenspec = JSON.parse(runOpenspec(['list', '--store', STORE_ID, '--json'], centralRepo, env)).changes ?? [];
  } catch (err) {
    console.error(`Ошибка: \`openspec list\` завершился с ошибкой: ${String(err.message).split('\n')[0]}`);
    process.exitCode = 1;
    return;
  }

  const specsDir = path.join(centralRepo, 'openspec', 'specs');
  const areasOnDisk = existsSync(specsDir)
    ? readdirSync(specsDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];
  const emptyAreas = areasOnDisk.filter((e) => readdirSync(path.join(specsDir, e.name)).length === 0).map((e) => e.name);

  const activeChanges = listActiveChanges(centralRepo);
  const changesWithoutProposal = activeChanges.filter(
    (id) => !existsSync(path.join(centralRepo, 'openspec', 'changes', id, 'proposal.md')),
  );

  if (specsFromOpenspec.length !== areasOnDisk.length || changesFromOpenspec.length !== activeChanges.length) {
    console.error('Внимание: openspec list видит не то же число областей/изменений, что файловая система.');
    console.error(`  openspec: ${specsFromOpenspec.length} областей, ${changesFromOpenspec.length} изменений`);
    console.error(`  диск:     ${areasOnDisk.length} областей, ${activeChanges.length} изменений`);
  }

  mkdirSync(path.dirname(registryPath), { recursive: true });
  let registry = {};
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch {
      registry = {};
    }
  }
  registry[centralRepo] = {
    lastSetupAt: new Date().toISOString(),
    openspecVersion,
    storeId: STORE_ID,
    areaCount: areasOnDisk.length,
    activeChangeCount: activeChanges.length,
  };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  // Проверка содержания обязательна (IV.2): отсутствие подключения выглядит не
  // как ошибка, а как тишина. Печатаем числа явно, даже если оба нули.
  console.log(`Центральный репозиторий: ${centralRepo}`);
  console.log(`Областей (openspec list --specs): ${specsFromOpenspec.length}`);
  console.log(`Активных изменений (openspec list): ${changesFromOpenspec.length}${activeChanges.length ? ' — ' + activeChanges.join(', ') : ''}`);
  console.log(`Реестр хранилищ sdd: ${registryPath}`);

  if (specsFromOpenspec.length === 0 && changesFromOpenspec.length === 0) {
    console.log('Внимание: областей и активных изменений нет. Это может быть ожидаемо (первый пилот) — не тишина, а факт.');
  }
  if (emptyAreas.length > 0) {
    console.log(`Внимание: области без содержимого (каталог есть, файлов нет): ${emptyAreas.join(', ')}`);
  }
  if (changesWithoutProposal.length > 0) {
    console.log(`Внимание: активные изменения без proposal.md: ${changesWithoutProposal.join(', ')}`);
  }
}
