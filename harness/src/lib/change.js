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
