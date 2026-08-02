import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { dirStats, ensureGitignored, EXCERPT_FILE_LIMIT } from '../src/commands/fetch-repos.js';

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
