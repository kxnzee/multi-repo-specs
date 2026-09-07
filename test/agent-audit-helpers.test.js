/** @fileoverview Executes shipped helper contracts independently of native agent clients. */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../extensions/superpowers/", import.meta.url));
const BASH = process.platform === "win32"
  ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean).map((root) => path.join(root, "Git", "bin", "bash.exe"))
    .find(existsSync) ?? "bash"
  : "bash";

/** Creates a disposable fixture. */
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-audit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/** Runs a shipped Bash helper with a bounded lifetime. */
function shell(script, args, cwd, prefix = 'exec "$@"') {
  return spawnSync(BASH, ["-c", prefix, "fixture", BASH, path.join(ROOT, script), ...args], {
    cwd, encoding: "utf8", timeout: 5000,
  });
}

test("visual launcher rejects missing option values instead of looping", async (t) => {
  const root = await temporary(t);
  for (const option of ["--project-dir", "--host", "--url-host", "--idle-timeout-minutes"]) {
    const result = shell("skills/brainstorming/scripts/start-server.sh", [option], root);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /requires a value/u);
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test("polluter scan runs an explicit runner and distinguishes inconclusive results", async (t) => {
  const root = await temporary(t);
  const script = "skills/systematic-debugging/find-polluter.sh";
  const args = ["pollution", "src/*.test.ts", "--", "project_runner", "literal ; $(touch injected)"];
  const runner = `project_runner() { [ "$#" -eq 2 ] && [ "$1" = 'literal ; $(touch injected)' ] && [ "$2" = "./src/with space.test.ts" ]; }; export -f project_runner; exec "$@"`;
  assert.equal(shell(script, ["pollution", "src/*.test.ts"], root).status, 2);
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(shell(script, args, root, runner).status, 2);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "with space.test.ts"), "fixture");
  const clean = shell(script, args, root, runner);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /1 selected test commands passed/u);
  assert.equal(existsSync(path.join(root, "injected")), false);
  const failed = shell(script, args, root,
    'project_runner() { return 1; }; export -f project_runner; exec "$@"');
  assert.equal(failed.status, 2);
  assert.equal(shell(script, ["pollution", "src/*.test.ts", "--", "missing-fixture-runner"], root).status, 2);
  const polluted = shell(script, args, root,
    'project_runner() { touch pollution; }; export -f project_runner; exec "$@"');
  assert.equal(polluted.status, 1, polluted.stderr);
  assert.match(polluted.stdout, /Polluter: \.\/src\/with space.test.ts/u);
  assert.equal(shell(script, args, root, runner).status, 2);
});

test("review package covers multiple commits and preserves output on invalid revision", async (t) => {
  const root = await temporary(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  const commit = (message) => git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", message);
  await fs.writeFile(path.join(root, "first"), "baseline");
  git("add", "first"); commit("baseline");
  const base = git("rev-parse", "HEAD");
  for (const name of ["one", "two"]) {
    await fs.writeFile(path.join(root, name), name);
    git("add", name); commit(name);
  }
  const output = path.join(root, "review with space.diff");
  const script = "skills/subagent-driven-development/scripts/review-package";
  const result = shell(script, [base, "HEAD", output], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), output);
  const contents = await fs.readFile(output, "utf8");
  assert.match(contents, /\+one/u); assert.match(contents, /\+two/u);
  assert.match(contents, new RegExp(git("rev-parse", "HEAD"), "u"));
  const invalid = shell(script, [base, "HEAD:first", output], root);
  assert.notEqual(invalid.status, 0);
  assert.equal(await fs.readFile(output, "utf8"), contents);
});

test("worktree review captures owned uncommitted content without changing the real index", async (t) => {
  const root = await temporary(t);
  const outputRoot = await temporary(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  for (const name of ["edited", "deleted", "unrelated"]) {
    await fs.writeFile(path.join(root, name), "baseline\n");
  }
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const base = git("rev-parse", "HEAD");
  await fs.writeFile(path.join(root, "edited"), "staged\n");
  git("add", "edited");
  await fs.writeFile(path.join(root, "edited"), "working\n");
  await fs.rm(path.join(root, "deleted"));
  await fs.writeFile(path.join(root, "new with space"), Buffer.from([0, 1, 2, 255]));
  await fs.writeFile(path.join(root, "unrelated"), "other owner's work\n");
  const indexPath = path.join(root, ".git", "index");
  const originalIndex = await fs.readFile(indexPath);
  const output = path.join(outputRoot, "review.diff");
  const script = "skills/subagent-driven-development/scripts/review-package";
  const args = [base, "--worktree", output, "--", "edited", "deleted", "new with space"];
  const result = shell(script, args, root);
  assert.equal(result.status, 0, result.stderr);
  const contents = await fs.readFile(output, "utf8");
  const tree = /^Snapshot tree: ([a-f0-9]+)$/mu.exec(contents)?.[1];
  assert.ok(tree);
  assert.match(contents, /Worktree snapshot: true/u);
  assert.match(contents, /\+working/u);
  assert.match(contents, /deleted file mode/u);
  assert.match(contents, /GIT binary patch/u);
  assert.equal(git("show", `${tree}:edited`), "working");
  assert.equal(git("show", `${tree}:unrelated`), "baseline");
  assert.deepEqual(execFileSync("git", ["show", `${tree}:new with space`], { cwd: root }), Buffer.from([0, 1, 2, 255]));
  assert.deepEqual(await fs.readFile(indexPath), originalIndex);
  assert.equal(git("rev-parse", "HEAD"), base);
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(await fs.readFile(path.join(root, "edited"), "utf8"), "working\n");

  // Repeated snapshots identify the same state; later fixes get a new tree.
  assert.equal(shell(script, args, root).status, 0);
  assert.equal(await fs.readFile(output, "utf8"), contents);
  await fs.writeFile(path.join(root, "edited"), "fixed\n");
  assert.equal(shell(script, args, root).status, 0);
  const fixed = await fs.readFile(output, "utf8");
  assert.notEqual(/^Snapshot tree: (.+)$/mu.exec(fixed)?.[1], tree);
  assert.notEqual(shell(script, [base, "--worktree", output, "--", "missing-path"], root).status, 0);
  assert.equal(await fs.readFile(output, "utf8"), fixed);
  assert.notEqual(shell(script, [base, "--worktree", output, "--"], root).status, 0);
  assert.notEqual(shell(script, [base, "--worktree", path.join(root, "unrelated"), "--", "edited"], root).status, 0);
  assert.equal(await fs.readFile(path.join(root, "unrelated"), "utf8"), "other owner's work\n");
  assert.deepEqual(await fs.readFile(indexPath), originalIndex);
});

test("visual explicit choice reaches the server event file, including falsey choices", async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "state"));
  const sent = [];
  let socket;
  const window = { location: { host: "localhost" }, sessionStorage: { getItem: () => null } };
  const context = {
    window, document: { querySelector: () => null, addEventListener() {} },
    WebSocket: class {
      static OPEN = 1;
      constructor() { socket = this; this.readyState = 1; }
      send(value) { sent.push(value); }
    },
  };
  vm.runInNewContext(await fs.readFile(path.join(ROOT, "skills/brainstorming/scripts/helper.js"), "utf8"), context);
  socket.onopen();
  window.brainstorm.choice("left"); window.brainstorm.choice(0);
  const filename = path.join(ROOT, "skills/brainstorming/scripts/server.cjs");
  const server = {
    require: createRequire(filename), __dirname: path.dirname(filename), module: { exports: {} },
    process: { env: { BRAINSTORM_DIR: root } }, console: { log() {}, error() {} }, Buffer,
  };
  vm.createContext(server);
  vm.runInContext(await fs.readFile(filename, "utf8"), server);
  for (const event of sent) { server.eventInput = event; vm.runInContext("handleMessage(eventInput)", server); }
  const events = (await fs.readFile(path.join(root, "state", "events"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((event) => event.choice), ["left", 0]);
  assert.equal(vm.runInContext("SUPERPOWERS_VERSION", server), "6.1.1");
});

test("graph renderer starts under both module types and reports invalid invocation", async (t) => {
  const root = await temporary(t);
  const source = await fs.readFile(path.join(ROOT, "skills/writing-skills/render-graphs.js"), "utf8");
  await fs.writeFile(path.join(root, "render-graphs.js"), source);
  for (const type of ["module", "commonjs"]) {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type }));
    const result = spawnSync(process.execPath, [path.join(root, "render-graphs.js")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: render-graphs/u);
    assert.doesNotMatch(result.stderr, /require is not defined|SyntaxError/u);
  }
});

test("Claude bootstrap includes canonical distribution routing and resume event", async () => {
  const instructions = await fs.readFile(path.join(ROOT, "agent-instructions.md"), "utf8");
  const output = execFileSync(process.execPath, [path.join(ROOT, "hooks/session-start.js")], { encoding: "utf8" });
  assert.ok(output.startsWith(instructions));
  assert.match(output, /OpenSpec routing/u);
  const hooks = JSON.parse(await fs.readFile(path.join(ROOT, "hooks/hooks.json"), "utf8"));
  assert.match("resume", new RegExp(hooks.hooks.SessionStart[0].matcher, "u"));
});

test("graph renderer returns failure when dot rejects a graph", async () => {
  const filename = path.join(ROOT, "skills/writing-skills/render-graphs.js");
  let source = await fs.readFile(filename, "utf8");
  source = source.replace(
    /const fs = await import\('node:fs'\);\nconst path = await import\('node:path'\);\nconst \{ execFileSync \} = await import\('node:child_process'\);/u,
    "const { fs, path, execFileSync } = dependencies;",
  );
  const written = [];
  const state = { argv: ["node", filename, "/fixture"] };
  await vm.runInNewContext(source, {
    process: state, console: { log() {}, error() {} },
    dependencies: {
      path,
      fs: {
        existsSync: () => true,
        readFileSync: () => "```dot\ndigraph invalid { invalid -> }\n```",
        writeFileSync: (...args) => written.push(args),
      },
      execFileSync(_file, args) {
        if (args.includes("-Tsvg")) throw new Error("invalid graph");
        return "dot version fixture";
      },
    },
  });
  assert.equal(state.exitCode, 1);
  assert.deepEqual(written, []);
});
