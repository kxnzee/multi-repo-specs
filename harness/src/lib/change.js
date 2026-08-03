import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { readFileIfExists } from './fs-util.js';

export const REQUIRED_ARTIFACTS = [
  'proposal.md',
  'specs',
  'impact-and-design.md',
  'tasks.md',
  'verification.md',
];

export const REQUIRED_DESIGN_SECTIONS = [
  '## Candidate Repositories',
  '## Read Log',
  '## Confirmed Repositories',
  '## Contracts',
  '## Design',
  '## Deployment and Rollout',
  '## Rollback',
];

export function changesRoot(centralRepoPath) {
  return path.join(centralRepoPath, 'openspec', 'changes');
}

export function changeDir(centralRepoPath, changeId) {
  return path.join(changesRoot(centralRepoPath), changeId);
}

export function isArchived(centralRepoPath, changeId) {
  return existsSync(path.join(changesRoot(centralRepoPath), 'archive', changeId));
}

export function listActiveChanges(centralRepoPath) {
  const root = changesRoot(centralRepoPath);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'archive')
    .map((e) => e.name);
}

export function isKebabCase(id) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

/**
 * Extracts the `candidate_repositories:` YAML block from impact-and-design.md.
 * The field is the only source `sdd fetch-repos` is allowed to read from —
 * command-line arguments do not add repositories (раздел 7 профиля Pilot Core).
 */
export function parseCandidateRepositories(impactAndDesignText) {
  const match = impactAndDesignText.match(/```ya?ml\n([\s\S]*?candidate_repositories:[\s\S]*?)```/);
  if (!match) return null;
  try {
    const doc = yaml.load(match[1]);
    if (!doc || !Array.isArray(doc.candidate_repositories)) return null;
    return doc.candidate_repositories;
  } catch {
    return null;
  }
}

export function readImpactAndDesign(centralRepoPath, changeId) {
  return readFileIfExists(path.join(changeDir(centralRepoPath, changeId), 'impact-and-design.md'));
}

/**
 * Parses Work Packages from tasks.md. Format — see templates/tasks.schema.md:
 * a single ```yaml fenced block with a `work_packages:` list, each entry
 * carrying an explicit `id` (this is what ends up in .sdd/change.yaml's
 * `work_packages` field — not the repository name).
 *
 *   ```yaml
 *   work_packages:
 *     - id: UI-01
 *       repository: ui
 *       type: implements
 *       scenario_ids: [ROLE-001, ROLE-002]
 *     - id: CONFIG-01
 *       repository: configuration
 *       type: enables
 *       ac_ids: [AC-PILOT-003.1]
 *   ```
 *
 * Returns [] (not an error) when the block is absent or malformed — callers
 * treat an empty list as "no Work Packages found", which rule 3 already
 * reports as blocking.
 */
export function parseWorkPackages(tasksText) {
  const match = tasksText.match(/```ya?ml\n([\s\S]*?work_packages:[\s\S]*?)```/);
  if (!match) return [];
  let doc;
  try {
    doc = yaml.load(match[1]);
  } catch {
    return [];
  }
  if (!doc || !Array.isArray(doc.work_packages)) return [];
  return doc.work_packages.map((entry) => ({
    id: entry.id ?? null,
    repo: entry.repository ?? null,
    type: entry.type ?? null,
    scenarioIds: Array.isArray(entry.scenario_ids) ? entry.scenario_ids : [],
    acIds: Array.isArray(entry.ac_ids) ? entry.ac_ids : [],
  }));
}

const SCENARIO_HEADER_RE = /^####\s+Scenario:\s+(\S+)\s+.*$/gm;

const DELTA_OPERATION_HEADERS = [
  '## ADDED Requirements',
  '## MODIFIED Requirements',
  '## REMOVED Requirements',
  '## RENAMED Requirements',
];
const NORMATIVE_WORD_RE = /\b(MUST NOT|MUST|SHALL|SHOULD|MAY)\b/;
const REQUIREMENT_HEADER_RE = /^###\s+Requirement:\s*(.+)$/gm;
// <ПРЕФИКС>-<NNN>: латиница верхнего регистра, ровно три цифры (I.7.4).
export const SCENARIO_ID_FORMAT = /^[A-Z][A-Z0-9]*-\d{3}$/;

/**
 * Проверяет один файл Delta Specs на соответствие I.7.3/I.7.4/I.7.5:
 * секция операции присутствует, у каждого `### Requirement:` есть
 * нормативное слово в первой строке тела и хотя бы один сценарий, формат
 * Scenario ID — `<ПРЕФИКС>-<NNN>`.
 *
 * Не проверяет: полноту MODIFIED-блока против текущей мастер-спеки (I.7.5)
 * — для этого нужен доступ к Master Specs той же capability на актуальной
 * ревизии, что выходит за объём MVP; отмечено как известное ограничение.
 */
export function validateDeltaSpecContent(content, filePath) {
  const issues = [];
  const hasOperation = DELTA_OPERATION_HEADERS.some((h) => content.includes(h));
  if (!hasOperation) {
    issues.push({
      what: 'нет секции операции дельты (## ADDED/MODIFIED/REMOVED/RENAMED Requirements)',
      where: filePath,
      fix: 'обернуть требования в одну из секций формата I.7.5',
    });
    return issues;
  }

  const requirementMatches = [...content.matchAll(REQUIREMENT_HEADER_RE)];
  for (let i = 0; i < requirementMatches.length; i++) {
    const m = requirementMatches[i];
    const start = m.index;
    const end = i + 1 < requirementMatches.length ? requirementMatches[i + 1].index : content.length;
    const body = content.slice(start, end);
    const afterHeader = body.slice(m[0].length).replace(/^\n+/, '');
    const firstLine = (afterHeader.split('\n')[0] || '').trim();

    if (!firstLine || !NORMATIVE_WORD_RE.test(firstLine)) {
      issues.push({
        what: `требование "${m[1].trim()}" не имеет нормативного слова (MUST/SHALL/MUST NOT/SHOULD/MAY) в строке сразу после заголовка`,
        where: filePath,
        fix: 'добавить MUST (или другое нормативное слово) первой строкой тела требования (I.7.3)',
      });
    }

    const scenarioMatches = [...body.matchAll(SCENARIO_HEADER_RE)];
    if (scenarioMatches.length === 0) {
      issues.push({
        what: `требование "${m[1].trim()}" не имеет ни одного сценария`,
        where: filePath,
        fix: 'добавить #### Scenario: <ПРЕФИКС>-<NNN> <название> (I.7.3: хотя бы один сценарий обязателен)',
      });
    }
    for (const sm of scenarioMatches) {
      if (!SCENARIO_ID_FORMAT.test(sm[1])) {
        issues.push({
          what: `Scenario ID "${sm[1]}" не соответствует формату <ПРЕФИКС>-<NNN>`,
          where: filePath,
          fix: 'использовать формат ПРЕФИКС-NNN (латиница верхнего регистра, три цифры), например ROLE-001 (I.7.4)',
        });
      }
    }
  }

  return issues;
}

/** Все Scenario ID, встреченные в тексте (для проверки сквозной уникальности). */
export function collectScenarioIds(content) {
  return [...content.matchAll(SCENARIO_HEADER_RE)].map((m) => m[1]);
}

/**
 * Извлекает полный текст сценария (заголовок + тело до следующего
 * заголовка сценария/требования) по Scenario ID — формат I.7.4:
 * `#### Scenario: <ПРЕФИКС>-<NNN> <название>`.
 *
 * `specFiles` — [{ path, content }], обычно все файлы `specs/` изменения на
 * ревизии Baseline (не из рабочего дерева — I.5.2: `sdd load` печатает
 * выжимку требований, которую агент не получает по умолчанию, и она обязана
 * быть той версией требований, что зафиксирована в Baseline).
 *
 * Возвращает Map<scenarioId, { file, text }>; отсутствующие ID просто не
 * попадают в карту — вызывающий код сам решает, что с этим делать.
 */
export function extractScenarios(specFiles, scenarioIds) {
  const wanted = new Set(scenarioIds);
  const found = new Map();
  for (const { path: filePath, content } of specFiles) {
    if (!content) continue;
    const headers = [];
    let m;
    SCENARIO_HEADER_RE.lastIndex = 0;
    while ((m = SCENARIO_HEADER_RE.exec(content))) {
      headers.push({ index: m.index, id: m[1] });
    }

    // Границы обрезки текста — не только следующий #### Scenario:, но и
    // следующий ### Requirement: (иначе текст последнего сценария
    // требования утекает в СЛЕДУЮЩЕЕ требование — баг, пойманный ручной
    // приёмкой fixture-Change: FIX-002 включал в себя заголовок и тело
    // совершенно другого требования).
    const boundaries = new Set(headers.map((h) => h.index));
    REQUIREMENT_HEADER_RE.lastIndex = 0;
    let rm;
    while ((rm = REQUIREMENT_HEADER_RE.exec(content))) {
      boundaries.add(rm.index);
    }
    const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

    for (const header of headers) {
      if (!wanted.has(header.id)) continue;
      const start = header.index;
      const nextBoundary = sortedBoundaries.find((b) => b > start);
      const end = nextBoundary ?? content.length;
      found.set(header.id, { file: filePath, text: content.slice(start, end).trimEnd() });
    }
  }
  return found;
}
