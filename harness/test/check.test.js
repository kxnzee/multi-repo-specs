import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkChange, checkCode } from '../src/commands/check.js';
import { parseCandidateRepositories, parseWorkPackages, isKebabCase } from '../src/lib/change.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

test('checkChange: valid fixture has no blocking findings', () => {
  const report = checkChange({ changeId: 'pilot-003', central: path.join(fixtures, 'central-valid') });
  assert.equal(report.hasBlocking, false);
});

test('checkChange: invalid fixture reports missing artifacts, missing Design section, and bad Work Packages', () => {
  const report = checkChange({ changeId: 'pilot-004', central: path.join(fixtures, 'central-invalid') });
  assert.equal(report.hasBlocking, true);

  const rules = report.findings.map((f) => f.rule);
  assert.ok(rules.includes('rule-1: required artifact'), 'missing specs/ and verification.md not caught');
  assert.ok(rules.includes('rule-1: impact-and-design schema'), 'missing Design section not caught');
  assert.ok(rules.includes('rule-3: implements needs scenarios'), 'implements without scenarios not caught');
  assert.ok(rules.includes('rule-3: enables must not have scenarios'), 'enables with scenarios not caught');
  assert.ok(rules.includes('rule-3: enables needs AC'), 'enables without AC not caught');
});

test('checkChange: rejects non-kebab-case change id', () => {
  const report = checkChange({ changeId: 'Pilot_003', central: path.join(fixtures, 'central-valid') });
  assert.equal(report.hasBlocking, true);
  assert.ok(report.findings.some((f) => f.rule === 'rule-1: change-id format'));
});

test('parseCandidateRepositories: reads the yaml block', () => {
  const text = '```yaml\ncandidate_repositories: [ui, backend]\n```';
  assert.deepEqual(parseCandidateRepositories(text), ['ui', 'backend']);
});

test('parseCandidateRepositories: returns null when the block is absent', () => {
  assert.equal(parseCandidateRepositories('no yaml here'), null);
});

test('parseWorkPackages: extracts scenario ids and AC ids per repo', () => {
  const text = '### ui — implements\nScenario IDs: A-1, A-2\n\n### configuration — enables\nAC: AC-1\n';
  const packages = parseWorkPackages(text);
  assert.equal(packages.length, 2);
  assert.deepEqual(packages[0], { repo: 'ui', type: 'implements', scenarioIds: ['A-1', 'A-2'], acIds: [] });
  assert.deepEqual(packages[1], { repo: 'configuration', type: 'enables', scenarioIds: [], acIds: ['AC-1'] });
});

test('isKebabCase', () => {
  assert.equal(isKebabCase('pilot-003'), true);
  assert.equal(isKebabCase('Pilot_003'), false);
  assert.equal(isKebabCase('pilot--003'), false);
});

function gitInit(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
}

test('checkCode: missing change card is blocking', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(dir);
    const report = checkCode({ repoPath: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: change card'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCode: valid card with annotated reachable tag passes rules 4 and 5', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(dir);
    execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-003/v1', '-m', 'baseline'], { cwd: dir });
    mkdirSync(path.join(dir, '.sdd'), { recursive: true });
    writeFileSync(
      path.join(dir, '.sdd', 'change.yaml'),
      'change_id: pilot-003\nspec_baseline: spec-baseline/pilot-003/v1\nspec_revision: abc123\nrepository: ui\nwork_packages: [ui]\n',
    );
    const report = checkCode({ repoPath: dir });
    assert.equal(report.hasBlocking, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCode: lightweight tag fails rule 4 (annotated tag required)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(dir);
    execFileSync('git', ['tag', 'spec-baseline/pilot-003/v1'], { cwd: dir });
    mkdirSync(path.join(dir, '.sdd'), { recursive: true });
    writeFileSync(
      path.join(dir, '.sdd', 'change.yaml'),
      'change_id: pilot-003\nspec_baseline: spec-baseline/pilot-003/v1\nspec_revision: abc123\nrepository: ui\nwork_packages: [ui]\n',
    );
    const report = checkCode({ repoPath: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: annotated tag'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCode: own OpenSpec root in a code repo fails rule 5', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(dir);
    execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-003/v1', '-m', 'baseline'], { cwd: dir });
    mkdirSync(path.join(dir, '.sdd'), { recursive: true });
    writeFileSync(
      path.join(dir, '.sdd', 'change.yaml'),
      'change_id: pilot-003\nspec_baseline: spec-baseline/pilot-003/v1\nspec_revision: abc123\nrepository: ui\nwork_packages: [ui]\n',
    );
    mkdirSync(path.join(dir, 'openspec'), { recursive: true });
    writeFileSync(path.join(dir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    const report = checkCode({ repoPath: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-5: no own OpenSpec root'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
