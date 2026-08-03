import { existsSync, readdirSync } from 'node:fs';
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
    .filter((e) => e.isDirectory() && e.name !== 'archive')
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
    files.push({ path: filePath, content: readFileIfExists(filePath) ?? '' });
  }
  for (const changeId of listActiveChanges(centralRepoPath)) {
    const specsDir = path.join(changeDir(centralRepoPath, changeId), 'specs');
    for (const filePath of listMarkdownFilesRecursive(specsDir)) {
      files.push({ path: filePath, content: readFileIfExists(filePath) ?? '' });
    }
  }
  return files;
}

const SCENARIO_HEADER_RE = /^####\s+Scenario:\s+(\S+)\s+.*$/gm;

/** Все Scenario ID, встреченные в тексте (для проверки сквозной уникальности). */
export function collectScenarioIds(content) {
  return [...content.matchAll(SCENARIO_HEADER_RE)].map((m) => m[1]);
}

// <ПРЕФИКС>-<NNN>: латиница верхнего регистра, ровно три цифры (I.7.4).
export const SCENARIO_ID_FORMAT = /^[A-Z][A-Z0-9]*-\d{3}$/;

/** Префикс из Scenario ID (`ROLE-001` → `ROLE`), или null, если формат не тот. */
export function scenarioPrefix(scenarioId) {
  const m = /^([A-Z][A-Z0-9]*)-\d{3}$/.exec(scenarioId);
  return m ? m[1] : null;
}
