import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PATHS = Object.freeze({
  skeleton: path.join(MODULE_ROOT, "skeleton"),
  openSpecConfig: path.join("openspec", "config.yaml"),
  sddConfig: "sdd.yaml",
  emptyDirectories: [
    path.join("openspec", "specs"),
    path.join("openspec", "changes"),
  ],
});

const REPOSITORY_PATTERN = /^([a-z0-9][a-z0-9-]*)=(.+)#([^#]+)$/;
const TEMPLATE_SUFFIX = ".template";

function run(command, ...args) {
  const result = spawnSync(command, args, { encoding: "utf8" });

  if (result.error) {
    throw new Error(`Не удалось запустить ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      `${command} ${args.join(" ")} завершилась с ошибкой${details ? `:\n${details}` : ""}`,
    );
  }

  return result.stdout.trim();
}

function tryRun(command, ...args) {
  try {
    return run(command, ...args);
  } catch {
    return "";
  }
}

function initializeOpenSpec(target) {
  run(
    "openspec",
    "init",
    target,
    "--tools",
    "none",
    "--profile",
    "custom",
    "--no-animation",
  );
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(root, relativeDirectory = "") {
  const entries = await fs.readdir(path.join(root, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function bundleTarget(relativePath) {
  return relativePath.endsWith(TEMPLATE_SUFFIX)
    ? relativePath.slice(0, -TEMPLATE_SUFFIX.length)
    : relativePath;
}

function detectCurrentRepository(target) {
  const url = tryRun("git", "-C", target, "remote", "get-url", "origin");
  if (!url) return null;

  return {
    id: "project-specs",
    url,
    defaultBranch: tryRun("git", "-C", target, "branch", "--show-current") || "main",
  };
}

function mergeRepositories(detectedRepository, configuredRepositories) {
  const repositories = [detectedRepository, ...configuredRepositories].filter(Boolean);
  const ids = new Set();

  for (const repository of repositories) {
    if (ids.has(repository.id)) {
      throw new Error(`Повторяющийся идентификатор репозитория: ${repository.id}`);
    }
    ids.add(repository.id);
  }

  return repositories;
}

function fillRepositories(template, repositories) {
  if (repositories.length === 0) return template;

  const entries = repositories
    .flatMap(({ id, url, defaultBranch }) => [
      `  - id: ${JSON.stringify(id)}`,
      `    url: ${JSON.stringify(url)}`,
      `    default_branch: ${JSON.stringify(defaultBranch)}`,
    ])
    .join("\n");

  return template.replace("repositories: []", `repositories:\n${entries}`);
}

export function parseRepository(value) {
  const match = value.match(REPOSITORY_PATTERN);
  if (!match) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }

  const [, id, url, defaultBranch] = match;
  return { id, url, defaultBranch };
}

export async function initProject({
  target = ".",
  repositories = [],
  force = false,
  skeletonRoot = PATHS.skeleton,
  openSpecRunner = initializeOpenSpec,
} = {}) {
  const projectRoot = path.resolve(target);
  await fs.mkdir(projectRoot, { recursive: true });

  const bundleFiles = (await listFiles(skeletonRoot)).map((source) => ({
    source,
    target: bundleTarget(source),
  }));
  const existingFiles = new Set();

  for (const file of bundleFiles) {
    if (await exists(path.join(projectRoot, file.target))) {
      existingFiles.add(file.target);
    }
  }

  const openSpecInitialized = !existingFiles.has(PATHS.openSpecConfig);
  if (openSpecInitialized) await openSpecRunner(projectRoot);

  await Promise.all(
    PATHS.emptyDirectories.map((directory) =>
      fs.mkdir(path.join(projectRoot, directory), { recursive: true }),
    ),
  );

  const created = [];
  const overwritten = [];
  const skipped = [];

  for (const file of bundleFiles) {
    const existed = existingFiles.has(file.target);
    if (existed && !force) {
      skipped.push(file.target);
      continue;
    }

    const source = path.join(skeletonRoot, file.source);
    const destination = path.join(projectRoot, file.target);
    await fs.mkdir(path.dirname(destination), { recursive: true });

    if (file.target === PATHS.sddConfig) {
      const template = await fs.readFile(source, "utf8");
      const detectedRepository = detectCurrentRepository(projectRoot);
      await fs.writeFile(
        destination,
        fillRepositories(template, mergeRepositories(detectedRepository, repositories)),
        "utf8",
      );
    } else {
      await fs.copyFile(source, destination);
    }

    (existed ? overwritten : created).push(file.target);
  }

  return {
    target: projectRoot,
    openSpecInitialized,
    created,
    overwritten,
    skipped,
  };
}
