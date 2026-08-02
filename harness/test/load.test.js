import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { load } from '../src/commands/load.js';

function gitInit(dir, branch = 'main') {
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function commit(dir, message) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function commitShaOf(dir, ref) {
  return execFileSync('git', ['rev-list', '-n', '1', ref], { cwd: dir, encoding: 'utf8' }).trim();
}

function writeChangeFiles(central, changeId, { tasksYaml, specsContent }) {
  const dir = path.join(central, 'openspec', 'changes', changeId);
  mkdirSync(path.join(dir, 'specs'), { recursive: true });
  writeFileSync(path.join(dir, 'proposal.md'), 'x');
  writeFileSync(path.join(dir, 'tasks.md'), `# Tasks: ${changeId}\n\n\`\`\`yaml\n${tasksYaml}\n\`\`\`\n`);
  if (specsContent) writeFileSync(path.join(dir, 'specs', 'DELTA.md'), specsContent);
}

function callCapturingExitCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  fn();
  const captured = process.exitCode;
  process.exitCode = original;
  return captured;
}

function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return logs.join('\n');
}

const TASKS_V1 = [
  'work_packages:',
  '  - id: UI-01',
  '    repository: ui',
  '    type: implements',
  '    scenario_ids: [PILOT-020]',
  '  - id: CONFIG-01',
  '    repository: configuration',
  '    type: enables',
  '    ac_ids: [AC-PILOT-020]',
].join('\n');

const SPEC_V1 = [
  '## ADDED Requirements',
  '',
  '### Requirement: Тестовое требование дня 4',
  'Система MUST делать нечто проверяемое.',
  '',
  '#### Scenario: PILOT-020 Основной случай',
  '- GIVEN предусловие',
  '- WHEN действие',
  '- THEN результат',
  '',
].join('\n');

test('load: reads tasks.md/specs from the Baseline commit, not from a later working-tree change', () => {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-central-'));
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-repo-'));
  try {
    gitInit(central);
    writeChangeFiles(central, 'pilot-020', { tasksYaml: TASKS_V1, specsContent: SPEC_V1 });
    commit(central, 'v1 content');
    execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-020/v1', '-m', 'baseline'], { cwd: central });
    const baselineCommit = commitShaOf(central, 'spec-baseline/pilot-020/v1');

    // После Baseline рабочее дерево уходит вперёд — load обязан игнорировать это.
    writeChangeFiles(central, 'pilot-020', {
      tasksYaml: 'work_packages:\n  - id: UI-99\n    repository: ui\n    type: implements\n    scenario_ids: [SHOULD-NOT-BE-USED]',
    });
    commit(central, 'post-baseline drift, must be ignored by load');

    gitInit(repoDir);
    let exitCode;
    const output = captureLogs(() => {
      exitCode = callCapturingExitCode(() => load({ changeId: 'pilot-020', repo: 'ui', central, targetPath: repoDir }));
    });
    assert.notEqual(exitCode, 1, output);

    const cardPath = path.join(repoDir, '.sdd', 'change.yaml');
    assert.ok(existsSync(cardPath));
    const card = yaml.load(readFileSync(cardPath, 'utf8'));
    assert.equal(card.spec_revision, baselineCommit, 'must record the commit SHA of the tag, not a lightweight ref');
    assert.deepEqual(card.work_packages, ['UI-01'], 'must use the Baseline tasks.md, not the drifted one');
    assert.deepEqual(card.scenario_ids, ['PILOT-020']);

    assert.match(output, /PILOT-020/);
    assert.match(output, /GIVEN предусловие/, 'must print the full scenario body, not just the id');
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('load: picks v10 over v9 (numeric sort, not lexicographic)', () => {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-central-'));
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-repo-'));
  try {
    gitInit(central);
    writeChangeFiles(central, 'pilot-021', { tasksYaml: TASKS_V1.replace(/PILOT-020/g, 'PILOT-021').replace(/AC-PILOT-020/, 'AC-PILOT-021') });
    commit(central, 'init');
    for (let n = 1; n <= 10; n++) {
      execFileSync('git', ['tag', '-a', `spec-baseline/pilot-021/v${n}`, '-m', `v${n}`], { cwd: central });
    }
    const v10Commit = commitShaOf(central, 'spec-baseline/pilot-021/v10');

    gitInit(repoDir);
    callCapturingExitCode(() => load({ changeId: 'pilot-021', repo: 'ui', central, targetPath: repoDir }));

    const card = yaml.load(readFileSync(path.join(repoDir, '.sdd', 'change.yaml'), 'utf8'));
    assert.equal(card.spec_baseline, 'spec-baseline/pilot-021/v10');
    assert.equal(card.spec_revision, v10Commit);
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('load: enables package prints readiness condition, dependent implements packages, and AC ids', () => {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-central-'));
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-repo-'));
  try {
    gitInit(central);
    writeChangeFiles(central, 'pilot-022', { tasksYaml: TASKS_V1.replace(/PILOT-020/g, 'PILOT-022').replace(/AC-PILOT-020/, 'AC-PILOT-022'), specsContent: SPEC_V1.replace(/PILOT-020/g, 'PILOT-022') });
    commit(central, 'init');
    execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-022/v1', '-m', 'baseline'], { cwd: central });

    gitInit(repoDir);
    const output = captureLogs(() => {
      callCapturingExitCode(() => load({ changeId: 'pilot-022', repo: 'configuration', central, targetPath: repoDir }));
    });

    assert.match(output, /AC-PILOT-022/);
    assert.match(output, /Условие готовности/);
    assert.match(output, /UI-01/, 'must list the dependent implements package');
    assert.match(output, /Сценариев нет/);

    const card = yaml.load(readFileSync(path.join(repoDir, '.sdd', 'change.yaml'), 'utf8'));
    assert.deepEqual(card.work_packages, ['CONFIG-01']);
    assert.deepEqual(card.scenario_ids, []);
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('load: refuses when the repository has no Work Package', () => {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-central-'));
  try {
    gitInit(central);
    writeChangeFiles(central, 'pilot-023', { tasksYaml: TASKS_V1.replace(/PILOT-020/g, 'PILOT-023').replace(/AC-PILOT-020/, 'AC-PILOT-023') });
    commit(central, 'init');
    execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-023/v1', '-m', 'baseline'], { cwd: central });

    const exitCode = callCapturingExitCode(() => load({ changeId: 'pilot-023', repo: 'backend', central }));
    assert.equal(exitCode, 1);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('load: refuses when Baseline does not exist', () => {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-load-central-'));
  try {
    gitInit(central);
    writeChangeFiles(central, 'pilot-024', { tasksYaml: TASKS_V1.replace(/PILOT-020/g, 'PILOT-024').replace(/AC-PILOT-020/, 'AC-PILOT-024') });
    commit(central, 'init'); // без тега

    const exitCode = callCapturingExitCode(() => load({ changeId: 'pilot-024', repo: 'ui', central }));
    assert.equal(exitCode, 1);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});
