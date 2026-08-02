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

export function currentBranch(cwd) {
  return run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
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
    const tagCommit = run(['rev-list', '-n', '1', tag], cwd);
    const merged = run(['branch', '--contains', tagCommit, branch], cwd);
    return merged.length > 0;
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
