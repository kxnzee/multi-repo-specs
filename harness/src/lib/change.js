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
 * Parses Work Packages from tasks.md. Expected format per repository:
 *
 *   ### ui — implements
 *   Scenario IDs: ROLE-001, ROLE-002
 *
 *   ### configuration — enables
 *   AC: AC-PILOT-003.1
 */
export function parseWorkPackages(tasksText) {
  const packages = [];
  const re = /^###\s+(\S+)\s+—\s+(implements|enables)\s*$/gm;
  let m;
  const lines = tasksText.split('\n');
  const headerIdx = [];
  while ((m = re.exec(tasksText))) {
    headerIdx.push({ index: m.index, repo: m[1], type: m[2] });
  }
  for (let i = 0; i < headerIdx.length; i++) {
    const start = headerIdx[i].index;
    const end = i + 1 < headerIdx.length ? headerIdx[i + 1].index : tasksText.length;
    const body = tasksText.slice(start, end);
    const scenarioMatch = body.match(/Scenario IDs:\s*(.+)/);
    const acMatch = body.match(/AC:\s*(.+)/);
    packages.push({
      repo: headerIdx[i].repo,
      type: headerIdx[i].type,
      scenarioIds: scenarioMatch ? scenarioMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [],
      acIds: acMatch ? acMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  return packages;
}
