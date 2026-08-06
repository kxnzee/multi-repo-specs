import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRepositoryId,
  parseSddConfig,
  parseStoreMetadata,
  serializeRepositories,
} from "../config/index.js";
import { runCommand } from "../shared/command.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const OPEN_SPEC_VERSION = "1.7.0";
const AGENT_ADAPTER = "qwen";
const TEMPLATE_SUFFIX = ".template";
const REPOSITORY_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/;

const PATHS = Object.freeze({
  skeleton: path.join(MODULE_ROOT, "skeleton"),
  metadata: path.join(".openspec-store", "store.yaml"),
  openSpec: "openspec",
  openSpecConfig: path.join("openspec", "config.yaml"),
  sddConfig: "sdd.yaml",
  agentDirectory: ".qwen",
});

async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
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
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

function bundleTarget(relativePath) {
  return relativePath.endsWith(TEMPLATE_SUFFIX)
    ? relativePath.slice(0, -TEMPLATE_SUFFIX.length)
    : relativePath;
}

function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  commandRunner(
    "openspec",
    ["init", projectRoot, "--tools", agentAdapter, "--profile", "core", "--no-animation"],
    { cwd: projectRoot },
  );
}

function setupStore(projectRoot, storeId, remote, commandRunner) {
  commandRunner(
    "openspec",
    [
      "store",
      "setup",
      storeId,
      "--path",
      projectRoot,
      "--no-init-git",
      "--remote",
      remote,
      "--json",
    ],
    { cwd: projectRoot, sensitiveValues: [remote] },
  );
}

async function inspectGit(projectRoot, commandRunner) {
  const gitRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot }),
  );
  if (gitRoot !== projectRoot) {
    throw new Error("sdd init нужно запускать из корня центрального Git-репозитория");
  }
  if (
    commandRunner("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: projectRoot,
    })
  ) {
    throw new Error("sdd init требует чистое рабочее дерево Git");
  }

  const remote = commandRunner("git", ["remote", "get-url", "origin"], {
    cwd: projectRoot,
  });
  const defaultBranch = commandRunner("git", ["branch", "--show-current"], {
    cwd: projectRoot,
  });
  if (!defaultBranch) throw new Error("sdd init нельзя запускать в detached HEAD");
  return { remote, defaultBranch };
}

async function assertSkeletonDoesNotExist(projectRoot, bundleFiles) {
  const conflicts = [];
  for (const relativePath of [PATHS.openSpec, ...bundleFiles.map(({ target }) => target)]) {
    if (await pathState(path.join(projectRoot, relativePath))) conflicts.push(relativePath);
  }
  if (conflicts.length > 0) {
    throw new Error(`Инициализации мешают существующие SDD/OpenSpec-пути: ${conflicts.join(", ")}`);
  }

  const agentDirectory = await pathState(path.join(projectRoot, PATHS.agentDirectory));
  if (agentDirectory && (!agentDirectory.isDirectory() || agentDirectory.isSymbolicLink())) {
    throw new Error(`${PATHS.agentDirectory}/ должна быть обычным каталогом`);
  }
}

async function installSkeleton({ projectRoot, skeletonRoot, bundleFiles, sddContents }) {
  const created = [];
  for (const file of bundleFiles) {
    const destination = path.join(projectRoot, file.target);
    await fs.mkdir(path.dirname(destination), { recursive: true });

    if (file.target === PATHS.sddConfig) {
      await fs.writeFile(destination, sddContents, "utf8");
    } else if (file.target === PATHS.openSpecConfig) {
      // `openspec init` создаёт базовый config, а SDD заменяет его командным шаблоном.
      await fs.copyFile(path.join(skeletonRoot, file.source), destination);
    } else {
      if (await pathState(destination)) {
        throw new Error(`OpenSpec создал конфликтующий файл skeleton: ${file.target}`);
      }
      await fs.copyFile(path.join(skeletonRoot, file.source), destination);
    }
    created.push(file.target);
  }
  return created;
}

/**
 * Разбирает значение CLI-флага `--repo <id=url#branch>`.
 *
 * @param {string} value
 * @returns {{id: string, role: "code", url: string, defaultBranch: string}}
 */
export function parseRepository(value) {
  const match = value.match(REPOSITORY_PATTERN);
  if (!match) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }
  const [, id, url, defaultBranch] = match;
  if (url.startsWith("-") || defaultBranch.startsWith("-")) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }
  return { id, role: "code", url, defaultBranch };
}

/**
 * Один раз подготавливает центральный репозиторий как OpenSpec Store.
 * Команда повторно безопасна только для Store с тем же ID; подключение новых
 * рабочих машин и code-репозиториев выполняет `sdd connect`.
 *
 * @param {object} [options]
 * @param {string} [options.target] Корень центрального Git-репозитория.
 * @param {string} options.storeId Общий ID Store и центрального репозитория.
 * @param {Array<{id: string, role: "code", url: string, defaultBranch: string}>} [options.repositories]
 * @param {string} [options.skeletonRoot] Переопределяется только в тестах.
 * @param {typeof runCommand} [options.commandRunner] Переопределяется только в тестах.
 * @param {string} [options.agentAdapter] Адаптер OpenSpec для текущего агента.
 * @returns {Promise<{
 *   target: string,
 *   storeId: string,
 *   alreadyInitialized: boolean,
 *   created: string[]
 * }>}
 */
export async function initProject({
  target = ".",
  storeId,
  repositories = [],
  skeletonRoot = PATHS.skeleton,
  commandRunner = runCommand,
  agentAdapter = AGENT_ADAPTER,
} = {}) {
  assertRepositoryId(storeId, "Store ID");
  const requestedRoot = path.resolve(target);
  const rootStat = await pathState(requestedRoot);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`sdd init требует существующий обычный каталог: ${requestedRoot}`);
  }
  const projectRoot = await fs.realpath(requestedRoot);

  const metadataStat = await pathState(path.join(projectRoot, PATHS.metadata));
  if (metadataStat) {
    if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) {
      throw new Error(`${PATHS.metadata} должна быть обычным файлом`);
    }
    const metadata = parseStoreMetadata(
      await fs.readFile(path.join(projectRoot, PATHS.metadata), "utf8"),
    );
    if (metadata.id !== storeId) {
      throw new Error(`Store уже инициализирован с ID ${metadata.id}, а не ${storeId}`);
    }
    // Identity уже зафиксирована OpenSpec: повторный init ничего не переписывает.
    return { target: projectRoot, storeId, alreadyInitialized: true, created: [] };
  }

  const bundleFiles = (await listFiles(skeletonRoot)).map((source) => ({
    source,
    target: bundleTarget(source),
  }));
  const git = await inspectGit(projectRoot, commandRunner);
  await assertSkeletonDoesNotExist(projectRoot, bundleFiles);

  const ids = new Set([storeId]);
  for (const repository of repositories) {
    assertRepositoryId(repository.id);
    if (ids.has(repository.id)) throw new Error(`Повторяющийся repository-id: ${repository.id}`);
    ids.add(repository.id);
  }

  const installedVersion = commandRunner("openspec", ["--version"], { cwd: projectRoot });
  if (installedVersion !== OPEN_SPEC_VERSION) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${OPEN_SPEC_VERSION}`);
  }

  const configuredRepositories = [
    {
      id: storeId,
      role: "store",
      url: git.remote,
      defaultBranch: git.defaultBranch,
    },
    ...repositories,
  ];
  const sddTemplate = await fs.readFile(path.join(skeletonRoot, PATHS.sddConfig), "utf8");
  const sddContents = serializeRepositories(sddTemplate, configuredRepositories);
  parseSddConfig(sddContents);

  const hasProjectFiles = (await fs.readdir(projectRoot)).some((entry) => entry !== ".git");
  // Для существующего проекта OpenSpec root нужен до Store setup; для пустого
  // репозитория Store setup сначала создаёт root, который затем принимает init.
  if (hasProjectFiles) installOpenSpec(projectRoot, agentAdapter, commandRunner);
  setupStore(projectRoot, storeId, git.remote, commandRunner);
  if (!hasProjectFiles) installOpenSpec(projectRoot, agentAdapter, commandRunner);

  const created = await installSkeleton({
    projectRoot,
    skeletonRoot,
    bundleFiles,
    sddContents,
  });
  return {
    target: projectRoot,
    storeId,
    alreadyInitialized: false,
    created: [PATHS.metadata, ...created],
  };
}
