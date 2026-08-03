import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileIfExists } from './fs-util.js';

export function changesRoot(centralRepoPath) {
  return path.join(centralRepoPath, 'openspec', 'changes');
}

export function changeDir(centralRepoPath, changeId) {
  return path.join(changesRoot(centralRepoPath), changeId);
}

export function listActiveChanges(centralRepoPath) {
  const root = changesRoot(centralRepoPath);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !['archive', 'cancelled'].includes(e.name))
    .map((e) => e.name);
}

export function listMarkdownFilesRecursive(dir) {
  const result = [];
  if (!existsSync(dir)) return result;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(full);
      }
    }
  }
  return result;
}

/**
 * Все Delta/Master Specs проекта, с которыми имеет дело сквозная
 * уникальность Scenario ID (I.7.4): Master Specs (`openspec/specs/`) плюс
 * specs/ всех АКТИВНЫХ изменений (`openspec/changes/<id>/specs/`, кроме
 * `archive/` — архивные уже применены к Master Specs, повторно их читать
 * не нужно). Возвращает [{ path, content }] с абсолютными путями.
 */
export function collectAllSpecFiles(centralRepoPath) {
  const files = [];
  const mastersDir = path.join(centralRepoPath, 'openspec', 'specs');
  for (const filePath of listMarkdownFilesRecursive(mastersDir)) {
    files.push({ path: filePath, content: readFileIfExists(filePath) ?? '', kind: 'master' });
  }
  for (const changeId of listActiveChanges(centralRepoPath)) {
    const specsDir = path.join(changeDir(centralRepoPath, changeId), 'specs');
    for (const filePath of listMarkdownFilesRecursive(specsDir)) {
      files.push({ path: filePath, content: readFileIfExists(filePath) ?? '', kind: 'delta' });
    }
  }
  return files;
}

/**
 * Delta Specs из явно указанной planning-ветки/PR ref. Сам CLI намеренно не
 * угадывает провайдера Git hosting: вызывающая сторона (человек или CI)
 * передаёт все открытые planning refs через `--planning-ref`.
 */
export function collectSpecFilesAtRef(centralRepoPath, ref) {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', ref, '--', 'openspec/changes'],
    { cwd: centralRepoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const files = [];
  for (const relativePath of output.split('\n').filter(Boolean)) {
    const parts = relativePath.split('/');
    const changeId = parts[2];
    if (
      parts[0] !== 'openspec' ||
      parts[1] !== 'changes' ||
      !changeId ||
      ['archive', 'cancelled'].includes(changeId) ||
      parts[3] !== 'specs' ||
      !relativePath.endsWith('.md')
    ) {
      continue;
    }
    const content = execFileSync('git', ['show', `${ref}:${relativePath}`], {
      cwd: centralRepoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    files.push({ path: relativePath, content, kind: 'delta', ref });
  }
  return files;
}

const SCENARIO_HEADER_RE = /^####\s+Scenario:\s+(\S+)\s+.*$/gm;

/** Все Scenario ID, встреченные в тексте (для проверки сквозной уникальности). */
export function collectScenarioIds(content) {
  return [...content.matchAll(SCENARIO_HEADER_RE)].map((m) => m[1]);
}

/**
 * Возвращает Scenario ID вместе с операцией дельты, в которой он записан.
 * Это принципиально для MODIFIED: полный блок обязан повторять прежние
 * сценарии из Master Spec, и такое повторение не является новым ID.
 */
export function collectScenarioOccurrences(content) {
  const result = [];
  let operation = null;
  for (const line of content.split('\n')) {
    const operationMatch = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/.exec(line.trim());
    if (operationMatch) {
      operation = operationMatch[1].toLowerCase();
      continue;
    }
    const scenarioMatch = /^####\s+Scenario:\s+(\S+)\s+.*$/.exec(line);
    if (scenarioMatch) result.push({ id: scenarioMatch[1], operation });
  }
  return result;
}

// <ПРЕФИКС>-<NNN>: латиница верхнего регистра, ровно три цифры (I.7.4).
export const SCENARIO_ID_FORMAT = /^[A-Z][A-Z0-9]*-\d{3}$/;

/** Префикс из Scenario ID (`ROLE-001` → `ROLE`), или null, если формат не тот. */
export function scenarioPrefix(scenarioId) {
  const m = /^([A-Z][A-Z0-9]*)-\d{3}$/.exec(scenarioId);
  return m ? m[1] : null;
}
