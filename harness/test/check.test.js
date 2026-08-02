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

test('checkChange: an existing but empty impact-and-design.md does not silently skip the schema check', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-empty-'));
  try {
    const changeDir = path.join(dir, 'openspec', 'changes', 'pilot-005');
    mkdirSync(path.join(changeDir, 'specs'), { recursive: true });
    writeFileSync(path.join(changeDir, 'proposal.md'), 'x');
    writeFileSync(path.join(changeDir, 'impact-and-design.md'), ''); // существует, но пуст
    writeFileSync(path.join(changeDir, 'tasks.md'), ''); // существует, но пуст
    writeFileSync(path.join(changeDir, 'verification.md'), 'x');

    const report = checkChange({ changeId: 'pilot-005', central: dir });
    assert.equal(report.hasBlocking, true);
    const rules = report.findings.map((f) => f.rule);
    assert.ok(rules.includes('rule-1: impact-and-design schema'), 'empty impact-and-design.md must still be checked for sections');
    assert.ok(rules.includes('rule-3: work packages'), 'empty tasks.md must still report missing work packages');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeChangeWithSpec(specContent, tasksYaml) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-spec-'));
  const changeDir = path.join(dir, 'openspec', 'changes', 'pilot-006');
  mkdirSync(path.join(changeDir, 'specs'), { recursive: true });
  writeFileSync(path.join(changeDir, 'proposal.md'), 'x');
  writeFileSync(path.join(changeDir, 'impact-and-design.md'), REQUIRED_DESIGN_SECTIONS_TEXT);
  writeFileSync(path.join(changeDir, 'specs', 'DELTA.md'), specContent);
  const defaultTasksYaml = 'work_packages:\n  - id: UI-01\n    repository: ui\n    type: implements\n    scenario_ids: [ROLE-001]';
  writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks: pilot-006\n\n\`\`\`yaml\n${tasksYaml ?? defaultTasksYaml}\n\`\`\`\n`);
  writeFileSync(path.join(changeDir, 'verification.md'), 'x');
  return dir;
}

const REQUIRED_DESIGN_SECTIONS_TEXT = [
  '## Candidate Repositories',
  '## Read Log',
  '## Confirmed Repositories',
  '## Contracts',
  '## Design',
  '## Deployment and Rollout',
  '## Rollback',
].join('\n\n');

test('checkChange: Delta Specs without a normative word (MUST/SHALL/...) is blocking', () => {
  const dir = makeChangeWithSpec(
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Просмотр роли',
      'Система отображает текущую роль сотрудника.', // нет MUST
      '',
      '#### Scenario: ROLE-001 Роль назначена',
      '- GIVEN x',
      '- WHEN y',
      '- THEN z',
    ].join('\n'),
  );
  try {
    const report = checkChange({ changeId: 'pilot-006', central: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-1: delta spec format' && f.what.includes('нормативного слова')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkChange: a requirement without any scenario is blocking', () => {
  const dir = makeChangeWithSpec(['## ADDED Requirements', '', '### Requirement: Просмотр роли', 'Система MUST отображать роль.'].join('\n'));
  try {
    const report = checkChange({ changeId: 'pilot-006', central: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.what.includes('ни одного сценария')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkChange: Scenario ID not matching <PREFIX>-<NNN> is blocking', () => {
  const dir = makeChangeWithSpec(
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Просмотр роли',
      'Система MUST отображать роль.',
      '',
      '#### Scenario: ROLE-1 Роль назначена',
      '- GIVEN x',
      '- WHEN y',
      '- THEN z',
    ].join('\n'),
  );
  try {
    const report = checkChange({ changeId: 'pilot-006', central: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.what.includes('не соответствует формату')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkChange: duplicate Scenario ID within the change is blocking', () => {
  const dir = makeChangeWithSpec(
    [
      '## ADDED Requirements',
      '',
      '### Requirement: A',
      'Система MUST делать A.',
      '',
      '#### Scenario: ROLE-001 Первый',
      '- GIVEN x',
      '- WHEN y',
      '- THEN z',
      '',
      '### Requirement: B',
      'Система MUST делать B.',
      '',
      '#### Scenario: ROLE-001 Второй, тот же ID',
      '- GIVEN x',
      '- WHEN y',
      '- THEN z',
    ].join('\n'),
  );
  try {
    const report = checkChange({ changeId: 'pilot-006', central: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-1: scenario id uniqueness'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkChange: a well-formed Delta Spec passes', () => {
  const dir = makeChangeWithSpec(
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Просмотр роли',
      'Система MUST отображать текущую роль сотрудника в карточке профиля.',
      '',
      '#### Scenario: ROLE-001 Роль назначена',
      '- GIVEN сотрудник с назначенной ролью',
      '- WHEN открывается карточка профиля',
      '- THEN в поле «Роль» отображается роль',
    ].join('\n'),
  );
  try {
    const report = checkChange({ changeId: 'pilot-006', central: dir });
    assert.equal(report.hasBlocking, false, JSON.stringify(report.findings, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseCandidateRepositories: reads the yaml block', () => {
  const text = '```yaml\ncandidate_repositories: [ui, backend]\n```';
  assert.deepEqual(parseCandidateRepositories(text), ['ui', 'backend']);
});

test('parseCandidateRepositories: returns null when the block is absent', () => {
  assert.equal(parseCandidateRepositories('no yaml here'), null);
});

test('parseWorkPackages: reads the work_packages yaml block with explicit ids', () => {
  const text = [
    '```yaml',
    'work_packages:',
    '  - id: UI-01',
    '    repository: ui',
    '    type: implements',
    '    scenario_ids: [A-1, A-2]',
    '  - id: CONFIG-01',
    '    repository: configuration',
    '    type: enables',
    '    ac_ids: [AC-1]',
    '```',
  ].join('\n');
  const packages = parseWorkPackages(text);
  assert.equal(packages.length, 2);
  assert.deepEqual(packages[0], { id: 'UI-01', repo: 'ui', type: 'implements', scenarioIds: ['A-1', 'A-2'], acIds: [] });
  assert.deepEqual(packages[1], { id: 'CONFIG-01', repo: 'configuration', type: 'enables', scenarioIds: [], acIds: ['AC-1'] });
});

test('parseWorkPackages: returns [] when the block is absent', () => {
  assert.deepEqual(parseWorkPackages('no yaml here'), []);
});

test('isKebabCase', () => {
  assert.equal(isKebabCase('pilot-003'), true);
  assert.equal(isKebabCase('Pilot_003'), false);
  assert.equal(isKebabCase('pilot--003'), false);
});

function gitInit(dir) {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
}

/** Central repo with an active `pilot-003` change dir and an annotated Baseline tag on `main`. */
function makeCentralWithBaseline() {
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-central-'));
  gitInit(central);
  mkdirSync(path.join(central, 'openspec', 'changes', 'pilot-003'), { recursive: true });
  writeFileSync(path.join(central, 'openspec', 'changes', 'pilot-003', 'proposal.md'), 'x');
  execFileSync('git', ['add', '-A'], { cwd: central });
  execFileSync('git', ['commit', '-q', '-m', 'add change dir'], { cwd: central });
  execFileSync('git', ['tag', '-a', 'spec-baseline/pilot-003/v1', '-m', 'baseline'], { cwd: central });
  // Ревизия КОММИТА, не объекта аннотированного тега — то, что теперь
  // сравнивает checkCode (регрессия на баг "SHA тега вместо SHA коммита").
  const revision = execFileSync('git', ['rev-list', '-n', '1', 'spec-baseline/pilot-003/v1'], { cwd: central, encoding: 'utf8' }).trim();
  return { central, revision };
}

function writeCard(repoPath, { revision = 'abc123' } = {}) {
  mkdirSync(path.join(repoPath, '.sdd'), { recursive: true });
  writeFileSync(
    path.join(repoPath, '.sdd', 'change.yaml'),
    `change_id: pilot-003\nspec_baseline: spec-baseline/pilot-003/v1\nspec_revision: ${revision}\nrepository: ui\nwork_packages: [UI-01]\n`,
  );
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

test('checkCode: without --central, Baseline cannot be verified and check fails closed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(dir);
    writeCard(dir);
    const report = checkCode({ repoPath: dir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: central repository required'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCode: valid card checked against a real central repo passes rules 4 and 5', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    writeCard(repoDir, { revision });
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: Baseline tag lives in the code repo, not central — must not be found there', () => {
  // Regression for the review finding: rule 4 used to look for the tag
  // inside --path (the code repo), where Baseline tags never exist.
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    // Тег специально НЕ создаётся в repoDir — так и должно быть в реальности.
    writeCard(repoDir, { revision });
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, false, 'tag must be looked up in central, not in the code repo');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: reachability check survives a detached HEAD in central (regression for currentBranch("HEAD") bug)', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    execFileSync('git', ['checkout', '-q', '--detach', 'HEAD'], { cwd: central });
    gitInit(repoDir);
    writeCard(repoDir, { revision });
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: lightweight tag fails rule 4 (annotated tag required)', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-central-'));
  try {
    gitInit(central);
    mkdirSync(path.join(central, 'openspec', 'changes', 'pilot-003'), { recursive: true });
    writeFileSync(path.join(central, 'openspec', 'changes', 'pilot-003', 'proposal.md'), 'x');
    execFileSync('git', ['add', '-A'], { cwd: central });
    execFileSync('git', ['commit', '-q', '-m', 'add change dir'], { cwd: central });
    execFileSync('git', ['tag', 'spec-baseline/pilot-003/v1'], { cwd: central }); // lightweight, не аннотированный

    gitInit(repoDir);
    writeCard(repoDir);
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: annotated tag'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: card revision mismatched with the actual tag revision is blocking', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    writeCard(repoDir, { revision: 'not-the-real-revision' });
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: revision matches card'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: change_id missing from central (neither active nor archived) is blocking', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const central = mkdtempSync(path.join(os.tmpdir(), 'sdd-central-'));
  try {
    gitInit(central); // central без каталога openspec/changes/pilot-003

    gitInit(repoDir);
    mkdirSync(path.join(repoDir, '.sdd'), { recursive: true });
    writeFileSync(
      path.join(repoDir, '.sdd', 'change.yaml'),
      'change_id: pilot-003\nspec_baseline: spec-baseline/pilot-003/v1\nspec_revision: abc123\nrepository: ui\nwork_packages: [UI-01]\n',
    );
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: change exists centrally'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: own OpenSpec root in a code repo fails rule 5', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    writeCard(repoDir, { revision });
    mkdirSync(path.join(repoDir, 'openspec'), { recursive: true });
    writeFileSync(path.join(repoDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-5: no own OpenSpec root'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: rule 5 also catches openspec/specs or openspec/changes without config.yaml', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    writeCard(repoDir, { revision });
    mkdirSync(path.join(repoDir, 'openspec', 'specs'), { recursive: true }); // без config.yaml
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-5: no own OpenSpec root'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: an empty spec_baseline value in the card is blocking, not silently skipped', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  const { central, revision } = makeCentralWithBaseline();
  try {
    gitInit(repoDir);
    mkdirSync(path.join(repoDir, '.sdd'), { recursive: true });
    // spec_baseline присутствует как ключ, но пуст — раньше substring-проверка
    // "includes('spec_baseline:')" такое пропускала.
    writeFileSync(
      path.join(repoDir, '.sdd', 'change.yaml'),
      `change_id: pilot-003\nspec_baseline:\nspec_revision: ${revision}\nrepository: ui\nwork_packages: [UI-01]\n`,
    );
    const report = checkCode({ repoPath: repoDir, central });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: change card fields'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(central, { recursive: true, force: true });
  }
});

test('checkCode: unparseable YAML in the card is blocking', () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'sdd-code-'));
  try {
    gitInit(repoDir);
    mkdirSync(path.join(repoDir, '.sdd'), { recursive: true });
    writeFileSync(path.join(repoDir, '.sdd', 'change.yaml'), 'change_id: [unclosed\n');
    const report = checkCode({ repoPath: repoDir });
    assert.equal(report.hasBlocking, true);
    assert.ok(report.findings.some((f) => f.rule === 'rule-4: change card parses'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
