import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findUp } from '../lib/fs-util.js';
import { listActiveChanges } from '../lib/change.js';

const CLI_VERSION = '0.1.0';
const REGISTRY_PATH = path.join(os.homedir(), '.sdd', 'registry.json');

/**
 * `sdd setup` — идемпотентна. Реестр хранилищ — машинное состояние (не в git):
 * "проверяет наличие CLI зафиксированной версии; находит центральный репозиторий;
 * регистрирует хранилище; проверяет, что требования действительно читаются —
 * не отсутствие ошибок, а наличие содержимого" (III.12).
 */
export function setup({ cwd = process.cwd() } = {}) {
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

  const specsDir = path.join(centralRepo, 'openspec', 'specs');
  const areaCount = existsSync(specsDir)
    ? readdirSync(specsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
    : 0;
  const activeChanges = listActiveChanges(centralRepo);

  mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  let registry = {};
  if (existsSync(REGISTRY_PATH)) {
    try {
      registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    } catch {
      registry = {};
    }
  }
  registry[centralRepo] = {
    lastSetupAt: new Date().toISOString(),
    areaCount,
    activeChangeCount: activeChanges.length,
  };
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));

  // Проверка содержания обязательна (IV.2): отсутствие подключения выглядит не
  // как ошибка, а как тишина. Печатаем числа явно, даже если оба нули.
  console.log(`Центральный репозиторий: ${centralRepo}`);
  console.log(`Областей (openspec/specs/*): ${areaCount}`);
  console.log(`Активных изменений: ${activeChanges.length}${activeChanges.length ? ' — ' + activeChanges.join(', ') : ''}`);
  console.log(`Реестр хранилищ: ${REGISTRY_PATH}`);

  if (areaCount === 0 && activeChanges.length === 0) {
    console.log('Внимание: областей и активных изменений нет. Это может быть ожидаемо (первый пилот) — не тишина, а факт.');
  }
}
