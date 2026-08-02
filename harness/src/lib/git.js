import { execFileSync } from 'node:child_process';

function run(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function isClean(cwd) {
  try {
    return run(['status', '--porcelain'], cwd) === '';
  } catch {
    return false;
  }
}

export function revParse(cwd, ref = 'HEAD') {
  return run(['rev-parse', ref], cwd);
}

/**
 * Ревизия, на которую указывает объект тега, а не SHA самого объекта тега.
 * `git rev-parse <tag>` на аннотированном теге возвращает SHA объекта-тега
 * (`tag`, не `commit`) — записывать его как spec_revision означает
 * фиксировать не ту ревизию. `rev-list -n1` всегда разыменовывает до коммита.
 */
export function commitSha(cwd, ref) {
  return run(['rev-list', '-n', '1', ref], cwd);
}

/** Содержимое файла на заданном ref, или null, если файла там нет. */
export function showFile(cwd, ref, relPath) {
  try {
    return execFileSync('git', ['show', `${ref}:${relPath}`], { cwd, encoding: 'utf8' });
  } catch {
    return null;
  }
}

/** Список файлов (относительные пути) под каталогом на заданном ref. */
export function listTreeFiles(cwd, ref, relDir) {
  try {
    const out = run(['ls-tree', '-r', '--name-only', ref, '--', relDir], cwd);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function currentBranch(cwd) {
  return run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/**
 * Determines the central repository's main branch — reachability of a
 * Baseline tag is checked against this, not against whatever branch the
 * checkout happens to be on (a detached HEAD in CI has no branch named
 * "HEAD", and a Code PR's own feature branch is not "основная ветка").
 */
export function defaultBranch(cwd, override) {
  if (override) return override;
  try {
    const ref = run(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    // Нет настроенного origin/HEAD (например, локальный репозиторий без
    // remote) — пробуем распространённые имена основной ветки.
  }
  for (const candidate of ['main', 'master']) {
    try {
      run(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], cwd);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function tagExists(cwd, tag) {
  try {
    run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], cwd);
    return true;
  } catch {
    return false;
  }
}

export function isAnnotatedTag(cwd, tag) {
  try {
    const type = run(['cat-file', '-t', tag], cwd);
    return type === 'tag';
  } catch {
    return false;
  }
}

export function isTagReachableFromBranch(cwd, tag, branch) {
  try {
    // --is-ancestor работает с любым ref (локальная ветка, origin/<branch>,
    // detached HEAD) — в отличие от `git branch --contains`, не требует,
    // чтобы <branch> существовала как локальная ветка.
    execFileSync('git', ['merge-base', '--is-ancestor', tag, branch], { cwd });
    return true;
  } catch {
    return false;
  }
}

export function clone(url, dest, { branch } = {}) {
  const args = ['clone', '--depth', '1'];
  if (branch) args.push('--branch', branch);
  args.push(url, dest);
  execFileSync('git', args, { stdio: 'inherit' });
}
