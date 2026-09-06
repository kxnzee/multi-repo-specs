#!/usr/bin/env node
// Portable task extraction and plan-scoped scratch identity.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function extractTask(source, number, repository) {
  if (!/^[1-9][0-9]*$/.test(number)) throw new Error('task number must be a positive integer');
  const matches = [];
  let currentRepository;
  let fence;
  let selected;
  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (selected) selected.lines.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      if (selected) selected.lines.push(line);
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (selected && level <= selected.level) selected = undefined;
      const repo = heading[2].match(/^Repository:\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?$/);
      if (level <= 2) currentRepository = repo?.[1];
      const task = heading[2].match(/^Task\s+([0-9]+)(?:\s*:|\s|$)/);
      if (task?.[1] === number && (repository === undefined || currentRepository === repository)) {
        selected = { level, lines: [] };
        matches.push(selected);
      }
    }
    if (selected) selected.lines.push(line);
  }
  if (matches.length !== 1) throw new Error(`task ${number}: expected one match, found ${matches.length}; specify --repo for repository-scoped plans`);
  return matches[0].lines.join('\n').trimEnd() + '\n';
}

function workspace(planFile, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const root = fs.realpathSync(git('rev-parse', '--show-toplevel'));
  let directory = path.join(root, '.superpowers', 'sdd');
  if (planFile) {
    const plan = fs.realpathSync(path.resolve(cwd, planFile));
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const identity = [root, plan, branch === 'HEAD' ? git('rev-parse', 'HEAD') : branch, fs.readFileSync(plan, 'utf8')];
    const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    directory = path.join(directory, key);
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.gitignore'), '*\n');
  return directory;
}

function main(args) {
  const operation = args.shift();
  if (operation === 'workspace' && args.length <= 1) return console.log(workspace(args[0]));
  if (operation !== 'brief') throw new Error('usage: task-context.cjs workspace [PLAN_FILE] | brief PLAN_FILE TASK_NUMBER [OUTFILE] [--repo REPOSITORY_ID]');
  const repoIndex = args.indexOf('--repo');
  let repository;
  if (repoIndex !== -1) {
    repository = args[repoIndex + 1];
    if (!repository || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(repository)) throw new Error('invalid --repo');
    args.splice(repoIndex, 2);
  }
  if (args.length < 2 || args.length > 3) throw new Error('expected PLAN_FILE TASK_NUMBER [OUTFILE] [--repo REPOSITORY_ID]');
  const [plan, number, output] = args;
  const brief = extractTask(fs.readFileSync(plan, 'utf8'), number, repository);
  const destination = output ?? path.join(workspace(plan), `task-${repository ? repository + '-' : ''}${number}-brief.md`);
  fs.writeFileSync(destination, brief);
  console.log(`wrote ${destination}`);
}

module.exports = { extractTask, workspace };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
