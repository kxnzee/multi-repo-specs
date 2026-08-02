import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirStats, ensureGitignored, EXCERPT_FILE_LIMIT, fetchRepos } from '../src/commands/fetch-repos.js';

test('ensureGitignored: adds the entry with a trailing slash when .gitignore is missing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-gitignore-'));
  try {
    ensureGitignored(dir, '.sdd-clones');
    const content = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(content, /^\.sdd-clones\/$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignored: does not duplicate an entry that already exists with a trailing slash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-gitignore-'));
  try {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.sdd-clones/\n');
    ensureGitignored(dir, '.sdd-clones');
    const content = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const occurrences = content.split('\n').filter((l) => l.replace(/\/$/, '') === '.sdd-clones').length;
    assert.equal(occurrences, 1, `expected exactly one .sdd-clones entry, got:\n${content}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignored: recognizes an existing entry without a trailing slash too', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-gitignore-'));
  try {
    writeFileSync(path.join(dir, '.gitignore'), '.sdd-clones\n');
    ensureGitignored(dir, '.sdd-clones');
    const content = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const occurrences = content.split('\n').filter((l) => l.replace(/\/$/, '') === '.sdd-clones').length;
    assert.equal(occurrences, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dirStats: counts files and bytes, ignoring .git', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-dirstats-'));
  try {
    mkdirSync(path.join(dir, '.git'));
    writeFileSync(path.join(dir, '.git', 'ignored'), 'x'.repeat(1000));
    writeFileSync(path.join(dir, 'a.txt'), 'hello');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'b.txt'), 'world!');

    const stats = dirStats(dir);
    assert.equal(stats.files, 2);
    assert.equal(stats.bytes, 'hello'.length + 'world!'.length);
    assert.equal(stats.exceeded, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dirStats: flags exceeded when the file count crosses the limit', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-dirstats-'));
  try {
    for (let i = 0; i < EXCERPT_FILE_LIMIT + 1; i++) {
      writeFileSync(path.join(dir, `f${i}.txt`), '');
    }
    const stats = dirStats(dir);
    assert.equal(stats.exceeded, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function callCapturingExitCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  fn();
  const captured = process.exitCode;
  process.exitCode = original;
  return captured;
}

function gitInit(dir, branch = 'main') {
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function makeSourceRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-source-'));
  gitInit(dir);
  writeFileSync(path.join(dir, 'README.md'), 'hello');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, revision };
}

function makeCentral(changeId, candidateRepos) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sdd-fetch-central-'));
  const changeDir = path.join(cwd, 'openspec', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  const yamlList = candidateRepos.map((r) => `"${r}"`).join(', ');
  writeFileSync(
    path.join(changeDir, 'impact-and-design.md'),
    `# Impact and Design: ${changeId}\n\n## Candidate Repositories\n\n\`\`\`yaml\ncandidate_repositories: [${yamlList}]\n\`\`\`\n`,
  );
  return cwd;
}

test('fetchRepos: rejects a non-kebab-case change id', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'sdd-fetch-'));
  try {
    const exitCode = callCapturingExitCode(() => fetchRepos({ change: 'Not_Kebab', cwd, reposConfig: {} }));
    assert.equal(exitCode, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('fetchRepos: excludes configuration from candidates without attempting to read it', () => {
  const cwd = makeCentral('pilot-010', ['configuration']);
  try {
    const exitCode = callCapturingExitCode(() => fetchRepos({ change: 'pilot-010', cwd, reposConfig: {} }));
    assert.notEqual(exitCode, 1, 'excluding configuration must not itself be a failure');
    assert.ok(!existsSync(path.join(cwd, '.sdd-clones', 'pilot-010', 'configuration')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('fetchRepos: rejects a repository name that could escape the clones directory', () => {
  const cwd = makeCentral('pilot-011', ['../../evil']);
  try {
    const exitCode = callCapturingExitCode(() =>
      fetchRepos({ change: 'pilot-011', cwd, reposConfig: { '../../evil': '/tmp/should-not-be-used' } }),
    );
    assert.equal(exitCode, 1);
    // Ничего не должно было появиться выше clonesRoot.
    assert.ok(!existsSync(path.join(cwd, '..', 'evil')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('fetchRepos: unregistered repository name fails closed', () => {
  const cwd = makeCentral('pilot-012', ['ui']);
  try {
    const exitCode = callCapturingExitCode(() => fetchRepos({ change: 'pilot-012', cwd, reposConfig: {} }));
    assert.equal(exitCode, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('fetchRepos: real clone records the actual revision and does not fabricate findings', () => {
  const { dir: sourceDir, revision } = makeSourceRepo();
  const cwd = makeCentral('pilot-013', ['ui']);
  try {
    const exitCode = callCapturingExitCode(() =>
      fetchRepos({ change: 'pilot-013', cwd, reposConfig: { ui: sourceDir } }),
    );
    assert.notEqual(exitCode, 1);

    const clonedPath = path.join(cwd, '.sdd-clones', 'pilot-013', 'ui');
    assert.ok(existsSync(clonedPath), 'clone must exist on disk');
    const clonedRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clonedPath, encoding: 'utf8' }).trim();
    assert.equal(clonedRevision, revision);

    const readLog = readFileSync(path.join(cwd, 'openspec', 'changes', 'pilot-013', 'read-log.md'), 'utf8');
    assert.match(readLog, new RegExp(revision));
    // Не должно утверждать содержательный результат, которого инструмент не проверял.
    assert.ok(!readLog.includes('Новых ограничений не обнаружено.\n'), 'must not fabricate a substantive finding');
    assert.match(readLog, /TODO/);
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
