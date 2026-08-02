import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import { setup, PINNED_OPENSPEC_VERSION, STORE_ID } from '../src/commands/setup.js';

function callCapturingExitCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  fn();
  const captured = process.exitCode;
  process.exitCode = original;
  return captured;
}

function makeCentralRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-setup-central-'));
  mkdirSync(path.join(dir, 'openspec', 'specs', 'auth'), { recursive: true });
  writeFileSync(path.join(dir, 'openspec', 'specs', 'auth', 'spec.md'), 'x');
  mkdirSync(path.join(dir, 'openspec', 'changes', 'pilot-030'), { recursive: true });
  writeFileSync(path.join(dir, 'openspec', 'changes', 'pilot-030', 'proposal.md'), 'x');
  writeFileSync(path.join(dir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return dir;
}

/**
 * Ставит на PATH поддельный `openspec`, чтобы тестировать setup.js без
 * сети и без реального глобального инструмента. Возвращает env с этим PATH.
 */
function fakeOpenspecEnv({ version = PINNED_OPENSPEC_VERSION, stores = [], specs = [], changes = [] } = {}) {
  const binDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-fake-bin-'));
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(${JSON.stringify(version)});
} else if (args[0] === 'store' && args[1] === 'list') {
  process.stdout.write(JSON.stringify({ stores: ${JSON.stringify(stores)} }));
} else if (args[0] === 'store' && args[1] === 'register') {
  process.stdout.write(JSON.stringify({ store: { id: '${STORE_ID}' } }));
} else if (args[0] === 'list' && args.includes('--specs')) {
  process.stdout.write(JSON.stringify({ specs: ${JSON.stringify(specs)} }));
} else if (args[0] === 'list') {
  process.stdout.write(JSON.stringify({ changes: ${JSON.stringify(changes)} }));
} else {
  process.exit(1);
}
`;
  const scriptPath = path.join(binDir, 'openspec');
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  // node-shebang скрипт запускаем напрямую как исполняемый файл (шебанг #!/usr/bin/env node)
  return { binDir, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } };
}

test('setup: fails clearly when openspec is not on PATH', () => {
  const central = makeCentralRepo();
  try {
    const registryPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sdd-registry-')), 'registry.json');
    const exitCode = callCapturingExitCode(() =>
      setup({ cwd: central, env: { ...process.env, PATH: '/nonexistent-bin-only' }, registryPath }),
    );
    assert.equal(exitCode, 1);
  } finally {
    rmSync(central, { recursive: true, force: true });
  }
});

test('setup: fails when the installed openspec version does not match the pinned one', () => {
  const central = makeCentralRepo();
  const { binDir, env } = fakeOpenspecEnv({ version: '0.0.1' });
  try {
    const registryPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sdd-registry-')), 'registry.json');
    const exitCode = callCapturingExitCode(() => setup({ cwd: central, env, registryPath }));
    assert.equal(exitCode, 1);
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('setup: registers the store and records real counts from openspec list', () => {
  const central = makeCentralRepo();
  const { binDir, env } = fakeOpenspecEnv({
    stores: [],
    specs: [{ id: 'auth' }],
    changes: [{ id: 'pilot-030' }],
  });
  try {
    const registryDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-registry-'));
    const registryPath = path.join(registryDir, 'registry.json');
    const exitCode = callCapturingExitCode(() => setup({ cwd: central, env, registryPath }));
    assert.notEqual(exitCode, 1);

    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    const entry = registry[central];
    assert.ok(entry, 'central repo must be registered');
    assert.equal(entry.areaCount, 1);
    assert.equal(entry.activeChangeCount, 1);
    assert.equal(entry.storeId, STORE_ID);
    assert.equal(entry.openspecVersion, PINNED_OPENSPEC_VERSION);
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('setup: does not re-register a store already known to openspec', () => {
  const central = makeCentralRepo();
  const { binDir, env } = fakeOpenspecEnv({
    stores: [{ id: STORE_ID, root: central }],
    specs: [{ id: 'auth' }],
    changes: [],
  });
  try {
    const registryPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sdd-registry-')), 'registry.json');
    let logs = '';
    const originalLog = console.log;
    console.log = (...args) => {
      logs += args.join(' ') + '\n';
    };
    try {
      callCapturingExitCode(() => setup({ cwd: central, env, registryPath }));
    } finally {
      console.log = originalLog;
    }
    assert.match(logs, /уже зарегистрировано/);
  } finally {
    rmSync(central, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
