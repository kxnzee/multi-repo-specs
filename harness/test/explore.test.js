import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildExploreInvocation,
  findSpecRoot,
  parseSddConfig,
  prepareExplore,
  runCommand,
  validateTicket,
} from "../explore/index.js";
import { initProject, parseRepository } from "../init/index.js";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeWritable(target) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o755);
    for (const entry of await fs.readdir(target)) await makeWritable(path.join(target, entry));
    return;
  }
  await fs.chmod(target, 0o644);
}

async function temporaryDirectory(t, prefix = "multi-repo-sdd-explore-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await makeWritable(directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function fakeOpenSpecInit(target) {
  await fs.mkdir(path.join(target, "openspec/specs"), { recursive: true });
  await fs.mkdir(path.join(target, "openspec/changes/archive"), { recursive: true });
  await fs.writeFile(path.join(target, "openspec/config.yaml"), "schema: spec-driven\n", "utf8");
}

async function createProject(t, codeRepositories = []) {
  const target = await temporaryDirectory(t);
  await initProject({
    target,
    repositories: [
      parseRepository("project-specs=https://example.test/project-specs.git#main"),
      ...codeRepositories,
    ],
    openSpecRunner: fakeOpenSpecInit,
  });
  await fs.writeFile(
    path.join(target, ".qwen", "commands", "opsx-explore.md"),
    "---\ndescription: Original OpenSpec explore action\n---\n",
    "utf8",
  );
  return target;
}

function commandRunnerFor(projectRoot) {
  return (command, args, options = {}) => {
    if (command === "openspec" && args[0] === "--version") return "1.7.0";
    if (command === "openspec" && args.join(" ") === "list --specs --json") {
      return JSON.stringify({ specs: [], root: { path: projectRoot } });
    }
    return runCommand(command, args, options);
  };
}

async function createGitRepository(t) {
  const repository = await temporaryDirectory(t, "multi-repo-sdd-source-");
  runCommand("git", ["init", "--initial-branch", "main", repository]);
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "SDD Tests"]);
  await fs.writeFile(path.join(repository, "README.md"), "test repository\n", "utf8");
  runCommand("git", ["-C", repository, "add", "README.md"]);
  runCommand("git", ["-C", repository, "commit", "-m", "Initial commit"]);
  return repository;
}

async function writeChange(projectRoot, relativeDirectory, state) {
  const directory = path.join(projectRoot, "openspec", "changes", relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, ".openspec.yaml"), "schema: multi-repo-sdd\n", "utf8");
  if (state !== null) await fs.writeFile(path.join(directory, "state.yaml"), state, "utf8");
}

test("parseSddConfig reads the managed repository registry", () => {
  const config = parseSddConfig(`versions:\n  openspec: "1.7.0"\nrepositories:\n  - id: project-specs\n    url: "https://example.test/specs.git"\n    default_branch: main\n  - id: api\n    url: "ssh://git@example.test/api.git"\n    default_branch: develop\n`);

  assert.equal(config.openSpecVersion, "1.7.0");
  assert.deepEqual(config.repositories.map(({ id }) => id), ["project-specs", "api"]);
  assert.equal(config.repositories[1].defaultBranch, "develop");
});

test("parseSddConfig rejects credentials embedded in HTTP repository URLs", () => {
  assert.throws(
    () =>
      parseSddConfig(`versions:\n  openspec: "1.7.0"\nrepositories:\n  - id: project-specs\n    url: "https://token@example.test/specs.git"\n    default_branch: main\n`),
    /содержит credential/,
  );
});

test("validateTicket accepts only uppercase Jira-style keys", () => {
  assert.equal(validateTicket("PAY-412"), "PAY-412");
  assert.throws(() => validateTicket("pay-412"), /формат/);
  assert.throws(() => validateTicket("PAY-0"), /формат/);
  assert.throws(() => validateTicket("PAY"), /формат/);
});

test("findSpecRoot resolves the nearest parent from a nested directory", async (t) => {
  const projectRoot = await createProject(t);
  const nested = path.join(projectRoot, "one", "two");
  await fs.mkdir(nested, { recursive: true });
  assert.equal(await findSpecRoot(nested), projectRoot);
});

test("prepareExplore publishes an empty workspace for project-specs-only Explore", async (t) => {
  const projectRoot = await createProject(t);
  let offeredRepositories;

  const result = await prepareExplore({
    start: path.join(projectRoot, "openspec", "context"),
    ticket: "PAY-412",
    commandRunner: commandRunnerFor(projectRoot),
    selectRepositories: async (repositories) => {
      offeredRepositories = repositories;
      return [];
    },
  });

  assert.deepEqual(offeredRepositories, []);
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.projectSpecsOnly, true);
  assert.deepEqual(result.repositories, []);
  assert.deepEqual(await fs.readdir(result.workspace), []);
  assert.equal((await fs.stat(result.workspace)).mode & 0o222, 0);
  await assert.rejects(fs.access(result.workspace, fs.constants.W_OK));
  assert.equal(
    await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8").then((text) =>
      text.split(/\r?\n/).includes(".sdd/checkouts/"),
    ),
    true,
  );
});

test("prepareExplore requires the original OpenSpec action to be installed", async (t) => {
  const projectRoot = await createProject(t);
  await fs.rm(path.join(projectRoot, ".qwen", "commands", "opsx-explore.md"));

  await assert.rejects(
    prepareExplore({
      start: projectRoot,
      ticket: "PAY-419",
      commandRunner: commandRunnerFor(projectRoot),
      selectRepositories: async () => [],
    }),
    /Не установлено оригинальное действие OpenSpec.*opsx-explore\.md/,
  );
});

test("buildExploreInvocation passes the SDD contract to the original action", () => {
  const invocation = buildExploreInvocation({
    ticket: "PAY-420",
    projectRoot: "/tmp/project-specs",
    workspace: "/tmp/project-specs/.sdd/checkouts/explore/pay-420",
    projectSpecsOnly: false,
    repositories: [
      {
        id: "api",
        branch: "main",
        revision: "0123456789abcdef0123456789abcdef01234567",
        path: "/tmp/project-specs/.sdd/checkouts/explore/pay-420/api",
      },
    ],
  });

  assert.match(invocation, /^\/opsx-explore PAY-420\./);
  assert.match(invocation, /Это Explore шага 01 SDD/);
  assert.match(invocation, /Code Repositories: api, branch=main/);
  assert.match(invocation, /0123456789abcdef0123456789abcdef01234567/);
  assert.match(invocation, /не создавай Change/);
  assert.match(invocation, /Не обращайся к Jira API/);
  assert.match(invocation, /Верни структурированный итог/);
});

test("buildExploreInvocation describes project-specs-only scope", () => {
  const invocation = buildExploreInvocation({
    ticket: "PAY-421",
    projectRoot: "/tmp/project-specs",
    workspace: "/tmp/project-specs/.sdd/checkouts/explore/pay-421",
    projectSpecsOnly: true,
    repositories: [],
  });

  assert.match(invocation, /Code Repositories не выбраны: исследуй только project-specs/);
});

test("prepareExplore clones selected repositories at exact clean revisions", async (t) => {
  const source = await createGitRepository(t);
  const projectRoot = await createProject(t, [
    parseRepository(`api=${source}#main`),
  ]);
  const sourceRevision = runCommand("git", ["-C", source, "rev-parse", "HEAD"]);

  const result = await prepareExplore({
    start: projectRoot,
    ticket: "PAY-413",
    commandRunner: commandRunnerFor(projectRoot),
    selectRepositories: async (repositories) => {
      assert.deepEqual(repositories.map(({ id }) => id), ["api"]);
      return ["api"];
    },
  });

  assert.equal(result.projectSpecsOnly, false);
  assert.equal(result.repositories[0].revision, sourceRevision);
  assert.equal(result.repositories[0].branch, "main");
  assert.equal(
    runCommand("git", ["-C", result.repositories[0].path, "status", "--porcelain"]),
    "",
  );
  assert.equal((await fs.stat(path.join(result.repositories[0].path, "README.md"))).mode & 0o222, 0);
});

test("prepareExplore blocks an active Change with the same ticket before selection", async (t) => {
  const projectRoot = await createProject(t);
  await writeChange(projectRoot, "pay-414-existing", "step: \"02\"\nticket: PAY-414\n");

  await assert.rejects(
    prepareExplore({
      start: projectRoot,
      ticket: "PAY-414",
      commandRunner: commandRunnerFor(projectRoot),
      selectRepositories: async () => {
        throw new Error("selection must not run");
      },
    }),
    /Активный Change.*pay-414-existing/,
  );
});

test("prepareExplore requires explicit confirmation for an archived ticket", async (t) => {
  const projectRoot = await createProject(t);
  await writeChange(
    projectRoot,
    path.join("archive", "2026-08-06-pay-415-old"),
    "step: \"13\"\nticket: PAY-415\n",
  );
  let archived;

  await assert.rejects(
    prepareExplore({
      start: projectRoot,
      ticket: "PAY-415",
      commandRunner: commandRunnerFor(projectRoot),
      confirmArchivedChange: async (changes) => {
        archived = changes;
        return false;
      },
      selectRepositories: async () => [],
    }),
    /архивный Change не подтверждён/,
  );
  assert.deepEqual(archived, [path.join("archive", "2026-08-06-pay-415-old")]);
});

test("prepareExplore fails closed on a Change with invalid state", async (t) => {
  const projectRoot = await createProject(t);
  await writeChange(projectRoot, "broken-change", "step: \"02\"\n");

  await assert.rejects(
    prepareExplore({
      start: projectRoot,
      ticket: "PAY-416",
      commandRunner: commandRunnerFor(projectRoot),
      selectRepositories: async () => [],
    }),
    /Невозможно проверить дубликаты.*ticket/,
  );
});

test("failed clone removes the previous final workspace and the lock", async (t) => {
  const missingSource = path.join(await temporaryDirectory(t, "multi-repo-sdd-missing-parent-"), "missing");
  const projectRoot = await createProject(t, [parseRepository(`api=${missingSource}#main`)]);
  const workspace = path.join(projectRoot, ".sdd", "checkouts", "explore", "pay-417");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "stale.txt"), "stale\n", "utf8");

  await assert.rejects(
    prepareExplore({
      start: projectRoot,
      ticket: "PAY-417",
      commandRunner: commandRunnerFor(projectRoot),
      selectRepositories: async () => ["api"],
    }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(missingSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );

  await assert.rejects(fs.stat(workspace), { code: "ENOENT" });
  await assert.rejects(
    fs.stat(path.join(projectRoot, ".sdd", "checkouts", "explore", ".pay-417.lock")),
    { code: "ENOENT" },
  );
  const entries = await fs.readdir(path.dirname(workspace));
  assert.equal(entries.some((entry) => entry.startsWith(".pay-417.tmp-")), false);
});

test("CLI rejects non-interactive explore before touching a project", () => {
  const result = spawnSync(process.execPath, ["bin/sdd.js", "explore", "--ticket", "PAY-418"], {
    cwd: HARNESS_ROOT,
    encoding: "utf8",
    input: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /требует интерактивный TTY/);
});
