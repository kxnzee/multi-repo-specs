import assert from "node:assert/strict";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseSddConfig } from "../config/index.js";
import { initProject, parseRepository } from "../init/index.js";
import { runCommand } from "../shared/command.js";

async function temporaryProject(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-init-"));
  const canonicalDirectory = await fs.realpath(directory);
  t.after(async () => fs.rm(canonicalDirectory, { recursive: true, force: true }));
  runCommand("git", ["init", "--initial-branch", "main", canonicalDirectory]);
  runCommand("git", ["-C", canonicalDirectory, "remote", "add", "origin", "https://example.test/specs.git"]);
  return canonicalDirectory;
}

function fakeOpenSpec(projectRoot) {
  const calls = [];
  let storeId;
  const runner = (command, args, options = {}) => {
    if (command === "git") return runCommand(command, args, options);
    assert.equal(command, "openspec");
    calls.push(args);

    if (args.join(" ") === "--version") return "1.7.0";
    if (args[0] === "store" && args[1] === "setup") {
      storeId = args[2];
      const remote = args[args.indexOf("--remote") + 1];
      fsSync.mkdirSync(path.join(projectRoot, ".openspec-store"), { recursive: true });
      fsSync.mkdirSync(path.join(projectRoot, "openspec", "specs"), { recursive: true });
      fsSync.mkdirSync(path.join(projectRoot, "openspec", "changes", "archive"), {
        recursive: true,
      });
      fsSync.writeFileSync(
        path.join(projectRoot, ".openspec-store", "store.yaml"),
        `version: 1\nid: ${storeId}\nremote: ${JSON.stringify(remote)}\n`,
      );
      fsSync.writeFileSync(
        path.join(projectRoot, "openspec", "config.yaml"),
        "schema: spec-driven\n",
      );
      return JSON.stringify({
        store: { id: storeId, root: projectRoot },
        registry: { registered: true, already_registered: false },
        git: { is_repository: true, initialized: false, committed: false },
        created_files: [],
        status: [],
      });
    }
    if (args[0] === "init") {
      fsSync.mkdirSync(path.join(projectRoot, ".qwen", "commands"), { recursive: true });
      fsSync.mkdirSync(path.join(projectRoot, ".qwen", "skills", "openspec-explore"), {
        recursive: true,
      });
      fsSync.writeFileSync(
        path.join(projectRoot, ".qwen", "commands", "opsx-explore.md"),
        "original OpenSpec action\n",
      );
      fsSync.writeFileSync(
        path.join(projectRoot, ".qwen", "skills", "openspec-explore", "SKILL.md"),
        "original OpenSpec skill\n",
      );
      return "initialized";
    }
    if (args.join(" ") === "store list --json") {
      return JSON.stringify({
        stores: storeId ? [{ id: storeId, root: projectRoot }] : [],
        status: [],
      });
    }
    if (args[0] === "store" && args[1] === "doctor") {
      return JSON.stringify({
        stores: [
          {
            id: storeId,
            root: projectRoot,
            metadata: { present: true, valid: true },
            openspec_root: { present: true, healthy: true, status: [] },
            status: [],
          },
        ],
        status: [],
      });
    }
    if (args[0] === "doctor") {
      return JSON.stringify({
        root: { path: projectRoot, source: "store", store_id: storeId, healthy: true, status: [] },
        store: { id: storeId, status: [] },
        references: [],
        status: [],
      });
    }
    if (args[0] === "context") {
      return JSON.stringify({
        root: { path: projectRoot, source: "store", store_id: storeId, role: "openspec_root" },
        members: [],
        status: [],
      });
    }
    throw new Error(`Unexpected OpenSpec call: ${args.join(" ")}`);
  };
  return { calls, runner };
}

test("parseRepository accepts the documented id=url#branch format", () => {
  assert.deepEqual(parseRepository("ui=https://example.test/ui.git#main"), {
    id: "ui",
    role: "code",
    url: "https://example.test/ui.git",
    defaultBranch: "main",
  });
});

test("parseRepository rejects ambiguous repository input", () => {
  assert.throws(() => parseRepository("UI=https://example.test/ui.git#main"), /Ожидается <id=url#branch>/);
  assert.throws(() => parseRepository("ui=https://example.test/ui.git"), /Ожидается <id=url#branch>/);
});

test("initProject creates Store, official core pack and the complete skeleton", async (t) => {
  const target = await temporaryProject(t);
  const openSpec = fakeOpenSpec(target);
  const result = await initProject({
    target,
    storeId: "payments-specs",
    repositories: [parseRepository("ui=https://example.test/ui.git#main")],
    commandRunner: openSpec.runner,
  });

  assert.equal(result.alreadyInitialized, false);
  assert.ok(
    openSpec.calls.some(
      (args) =>
        args[0] === "store" &&
        args[1] === "setup" &&
        args.includes("--no-init-git") &&
        args.includes("--remote"),
    ),
  );
  assert.ok(
    openSpec.calls.some(
      (args) => args[0] === "init" && args.includes("qwen") && args.includes("core"),
    ),
  );

  const expectedFiles = [
    ".openspec-store/store.yaml",
    ".qwen/commands/opsx-explore.md",
    ".qwen/commands/sdd-context.md",
    ".qwen/skills/openspec-explore/SKILL.md",
    "openspec/config.yaml",
    "openspec/context/00-start-here.md",
    "openspec/context/08-release-process.md",
    "openspec/context/system-map.yaml",
    "openspec/context/ADR/README.md",
    "openspec/context/_raw/README.md",
    "openspec/schemas/multi-repo-sdd/schema.yaml",
    "openspec/schemas/multi-repo-sdd/templates/research.md",
    "QWEN.md",
    "sdd.yaml",
    "CODEOWNERS",
    ".gitignore",
  ];
  for (const relativePath of expectedFiles) {
    assert.equal((await fs.stat(path.join(target, relativePath))).isFile(), true, relativePath);
  }

  assert.equal(
    await fs.readFile(path.join(target, ".qwen", "commands", "opsx-explore.md"), "utf8"),
    "original OpenSpec action\n",
  );
  const config = parseSddConfig(await fs.readFile(path.join(target, "sdd.yaml"), "utf8"));
  assert.deepEqual(config.storeRepository, {
    id: "payments-specs",
    role: "store",
    url: "https://example.test/specs.git",
    defaultBranch: "main",
  });
  assert.deepEqual(config.codeRepositories.map(({ id }) => id), ["ui"]);

  const openSpecConfig = await fs.readFile(path.join(target, "openspec/config.yaml"), "utf8");
  assert.match(openSpecConfig, /^schema: multi-repo-sdd/m);
  const contextCommand = await fs.readFile(
    path.join(target, ".qwen/commands/sdd-context.md"),
    "utf8",
  );
  assert.match(contextCommand, /\.openspec-store\/store\.yaml/);
  assert.match(contextCommand, /явно передавай `--store <store-id>`/);
  assert.match(contextCommand, /ровно один вопрос за раз/);
});

test("initProject refuses a dirty repository before invoking OpenSpec", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "user-change.txt"), "dirty\n", "utf8");
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({
      target,
      storeId: "payments-specs",
      commandRunner: openSpec.runner,
    }),
    /чистое рабочее дерево/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(fsSync.existsSync(path.join(target, ".openspec-store")), false);
});

test("initProject does not modify an already initialized Store", async (t) => {
  const target = await temporaryProject(t);
  await fs.mkdir(path.join(target, ".openspec-store"));
  await fs.writeFile(
    path.join(target, ".openspec-store", "store.yaml"),
    'version: 1\nid: payments-specs\nremote: "https://example.test/specs.git"\n',
  );
  const openSpec = fakeOpenSpec(target);

  const result = await initProject({
    target,
    storeId: "payments-specs",
    commandRunner: openSpec.runner,
  });
  assert.equal(result.alreadyInitialized, true);
  assert.deepEqual(result.created, []);
  assert.deepEqual(openSpec.calls, []);
});

test("initProject blocks conflicting skeleton paths instead of overwriting them", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "sdd.yaml"), "user owned\n", "utf8");
  runCommand("git", ["-C", target, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", target, "config", "user.name", "SDD Tests"]);
  runCommand("git", ["-C", target, "add", "sdd.yaml"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await assert.rejects(
    initProject({ target, storeId: "payments-specs", commandRunner: openSpec.runner }),
    /существующие SDD\/OpenSpec-пути: sdd.yaml/,
  );
  assert.deepEqual(openSpec.calls, []);
  assert.equal(await fs.readFile(path.join(target, "sdd.yaml"), "utf8"), "user owned\n");
});

test("initProject adopts a non-empty central repository through the official OpenSpec root", async (t) => {
  const target = await temporaryProject(t);
  await fs.writeFile(path.join(target, "README.md"), "existing project\n", "utf8");
  configureRepository(target);
  runCommand("git", ["-C", target, "add", "README.md"]);
  runCommand("git", ["-C", target, "commit", "-m", "existing project"]);
  const openSpec = fakeOpenSpec(target);

  await initProject({
    target,
    storeId: "payments-specs",
    commandRunner: openSpec.runner,
  });

  const initIndex = openSpec.calls.findIndex((args) => args[0] === "init");
  const setupIndex = openSpec.calls.findIndex(
    (args) => args[0] === "store" && args[1] === "setup",
  );
  assert.ok(initIndex >= 0 && setupIndex > initIndex);
  assert.equal(await fs.readFile(path.join(target, "README.md"), "utf8"), "existing project\n");
});

function configureRepository(repository) {
  runCommand("git", ["-C", repository, "config", "user.email", "tests@example.test"]);
  runCommand("git", ["-C", repository, "config", "user.name", "SDD Tests"]);
}
