import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { checkContext, checkIds } from '../src/commands/check.js';

function makeCentral() {
  return mkdtempSync(path.join(os.tmpdir(), 'sdd-central-ctx-'));
}

function writeMinimalContext(central) {
  const contextDir = path.join(central, 'openspec', 'context');
  mkdirSync(contextDir, { recursive: true });
  for (const name of ['00-start-here.md', '02-domain-glossary.md', '03-architecture.md', '09-scenario-prefixes.md']) {
    writeFileSync(path.join(contextDir, name), 'short file\n');
  }
  writeFileSync(path.join(contextDir, 'system-map.yaml'), 'systems: []\n');
  return contextDir;
}

test('checkContext: missing openspec/context/ is a warning, not blocking', () => {
  const central = makeCentral();
  try {
    const report = checkContext({ central });
    assert.equal(report.hasBlocking, false);
    assert.ok(report.findings.some((f) => f.rule === 'context: directory missing'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkContext: flags files over the line-count guideline, ignores _raw/', () => {
  const central = makeCentral();
  try {
    const contextDir = writeMinimalContext(central);
    mkdirSync(path.join(contextDir, '_raw'), { recursive: true });
    writeFileSync(path.join(contextDir, '03-architecture.md'), Array(80).fill('line').join('\n'));
    writeFileSync(path.join(contextDir, '_raw', 'interview-2026-08-03-architect.md'), Array(500).fill('raw notes').join('\n'));

    const report = checkContext({ central });
    assert.equal(report.hasBlocking, false, 'volume is advisory only');
    const flagged = report.findings.filter((f) => f.rule === 'context: file size');
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].where, /03-architecture\.md/);
    assert.ok(!report.findings.some((f) => f.where.includes('_raw')), '_raw/ must not be counted');
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkContext: file within the guideline is not flagged', () => {
  const central = makeCentral();
  try {
    const contextDir = writeMinimalContext(central);
    writeFileSync(path.join(contextDir, '02-domain-glossary.md'), Array(30).fill('line').join('\n'));

    const report = checkContext({ central });
    assert.equal(report.findings.length, 0);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

function writeSpecFile(dir, filename, content) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), content);
}

const REQ = (id) =>
  ['## ADDED Requirements', '', `### Requirement: R for ${id}`, 'Система MUST делать нечто.', '', `#### Scenario: ${id} Название`, '- GIVEN x', '- WHEN y', '- THEN z'].join(
    '\n',
  );

test('checkIds: no prefix given — reports project-wide duplicate Scenario IDs as blocking', () => {
  const central = makeCentral();
  try {
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));
    mkdirSync(path.join(central, 'openspec', 'changes'), { recursive: true });
    writeSpecFile(path.join(central, 'openspec', 'changes', 'some-change', 'specs'), 'DELTA.md', REQ('ROLE-001'));

    const report = checkIds({ central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'ids: scenario id uniqueness' && f.what.includes('ROLE-001')));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: unique IDs across Master Specs and active changes pass cleanly', () => {
  const central = makeCentral();
  try {
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));
    writeSpecFile(path.join(central, 'openspec', 'changes', 'some-change', 'specs'), 'DELTA.md', REQ('ROLE-002'));

    const report = checkIds({ central });
    assert.equal(report.hasBlocking, false);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: warns when open planning refs were not supplied', () => {
  const central = makeCentral();
  try {
    const report = checkIds({ central });
    assert.equal(report.hasBlocking, false);
    assert.ok(report.findings.some((f) => f.rule === 'ids: planning refs coverage'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: scans explicitly supplied planning refs', () => {
  const central = makeCentral();
  try {
    execFileSync('git', ['init', '-b', 'master'], { cwd: central });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: central });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: central });
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));
    execFileSync('git', ['add', '.'], { cwd: central });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: central });

    execFileSync('git', ['checkout', '-b', 'planning/other'], { cwd: central });
    writeSpecFile(path.join(central, 'openspec', 'changes', 'other-change', 'specs'), 'DELTA.md', REQ('ROLE-002'));
    execFileSync('git', ['add', '.'], { cwd: central });
    execFileSync('git', ['commit', '-m', 'planning'], { cwd: central });
    execFileSync('git', ['checkout', 'master'], { cwd: central });
    writeSpecFile(path.join(central, 'openspec', 'changes', 'current-change', 'specs'), 'DELTA.md', REQ('ROLE-002'));

    const report = checkIds({ central, planningRefs: ['planning/other'] });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'ids: scenario id uniqueness' && f.where.includes('planning/other:')));
    assert.ok(!report.findings.some((f) => f.rule === 'ids: planning refs coverage'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: an unavailable planning ref blocks an incomplete check', () => {
  const central = makeCentral();
  try {
    execFileSync('git', ['init', '-b', 'master'], { cwd: central });
    const report = checkIds({ central, planningRefs: ['missing/ref'] });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'ids: planning ref unavailable'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: an existing Scenario ID carried by a MODIFIED requirement is not a duplicate', () => {
  const central = makeCentral();
  try {
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));
    const modified = REQ('ROLE-001').replace('## ADDED Requirements', '## MODIFIED Requirements');
    writeSpecFile(path.join(central, 'openspec', 'changes', 'some-change', 'specs'), 'DELTA.md', modified);

    const report = checkIds({ central });
    assert.equal(report.hasBlocking, false);
    assert.ok(!report.findings.some((f) => f.rule === 'ids: scenario id uniqueness'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: archived changes are not re-scanned (already folded into Master Specs)', () => {
  const central = makeCentral();
  try {
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));
    // Тот же ID в archive/ — не должен считаться дубликатом: архив не сканируется.
    writeSpecFile(path.join(central, 'openspec', 'changes', 'archive', 'old-change', 'specs'), 'DELTA.md', REQ('ROLE-001'));

    const report = checkIds({ central });
    assert.equal(report.hasBlocking, false);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: --prefix reports occupancy without blocking', () => {
  const central = makeCentral();
  try {
    writeSpecFile(path.join(central, 'openspec', 'specs', 'auth'), 'spec.md', REQ('ROLE-001'));

    const occupied = checkIds({ central, prefix: 'ROLE' });
    assert.equal(occupied.hasBlocking, false);
    assert.ok(occupied.findings.some((f) => f.rule === 'ids: prefix occupancy'));

    const free = checkIds({ central, prefix: 'BILLING' });
    assert.equal(free.hasBlocking, false);
    assert.ok(!free.findings.some((f) => f.rule === 'ids: prefix occupancy'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: --prefix also honors a reserved registry entry before the first Scenario exists', () => {
  const central = makeCentral();
  try {
    const contextDir = path.join(central, 'openspec', 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(
      path.join(contextDir, '09-scenario-prefixes.md'),
      '| Префикс | Область | Владелец |\n|---|---|---|\n| `PILOT-` | pilot | architect |\n',
    );

    const occupied = checkIds({ central, prefix: 'pilot-' });
    assert.equal(occupied.hasBlocking, false);
    assert.ok(occupied.findings.some((f) => f.rule === 'ids: prefix occupancy'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkIds: rejects an invalid prefix instead of reporting it free', () => {
  const central = makeCentral();
  try {
    const report = checkIds({ central, prefix: 'bad prefix' });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'ids: prefix format'));
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});
