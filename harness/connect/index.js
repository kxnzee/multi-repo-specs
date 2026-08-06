import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseSddConfig, parseStoreMetadata, sameGitRemote } from "../config/index.js";
import { runCommand } from "../shared/command.js";

const OPEN_SPEC_VERSION = "1.7.0";
const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  sddConfig: "sdd.yaml",
  openSpec: "openspec",
  pointer: path.join("openspec", "config.yaml"),
});

async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readFile(root, relativePath) {
  const target = path.join(root, relativePath);
  const stat = await pathState(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Отсутствует обычный файл ${relativePath}`);
  }
  return fs.readFile(target, "utf8");
}

/**
 * Проверяет существующий checkout без fetch/pull и других изменений Git.
 *
 * @param {string} repositoryRoot
 * @param {{id: string, url: string, defaultBranch: string}} repository
 * @param {typeof runCommand} commandRunner
 * @returns {{branch: string, revision: string}}
 */
function inspectCheckout(repositoryRoot, repository, commandRunner) {
  const gitRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }),
  );
  if (gitRoot !== repositoryRoot) {
    throw new Error(`${repository.id}: каталог не является корнем Git-репозитория`);
  }
  const origin = commandRunner("git", ["remote", "get-url", "origin"], {
    cwd: repositoryRoot,
  });
  if (!sameGitRemote(origin, repository.url)) {
    throw new Error(`${repository.id}: origin не совпадает с sdd.yaml`);
  }
  const branch = commandRunner("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
  });
  if (branch !== repository.defaultBranch) {
    throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  }
  if (commandRunner("git", ["status", "--porcelain"], { cwd: repositoryRoot })) {
    throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  }
  return {
    branch,
    revision: commandRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
  };
}

/**
 * Создаёт минимальный OpenSpec pointer. Локальные specs/changes намеренно
 * блокируют действие: их перенос в Store требует отдельного решения человека.
 *
 * @param {string} repositoryRoot
 * @param {string} storeId
 * @returns {Promise<boolean>} true, если pointer был создан.
 */
async function ensurePointer(repositoryRoot, storeId) {
  const openSpecRoot = path.join(repositoryRoot, PATHS.openSpec);
  for (const directory of ["specs", "changes"]) {
    if (await pathState(path.join(openSpecRoot, directory))) {
      throw new Error(
        `${repositoryRoot} содержит локальный openspec/${directory}; требуется отдельная миграция`,
      );
    }
  }

  const pointerPath = path.join(repositoryRoot, PATHS.pointer);
  const pointerStat = await pathState(pointerPath);
  if (!pointerStat) {
    await fs.mkdir(openSpecRoot, { recursive: true });
    await fs.writeFile(pointerPath, `store: ${storeId}\n`, "utf8");
    return true;
  }
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${PATHS.pointer} должна быть обычным файлом`);
  }
  if ((await fs.readFile(pointerPath, "utf8")).replaceAll("\r\n", "\n") !== `store: ${storeId}\n`) {
    throw new Error(`${PATHS.pointer} должна содержать только 'store: ${storeId}'`);
  }
  return false;
}

/**
 * @param {string} storeRoot
 * @param {string | undefined} requestedWorkspace
 * @returns {Promise<string>}
 */
async function resolveWorkspace(storeRoot, requestedWorkspace) {
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : path.basename(path.dirname(storeRoot)) === "openspec"
      ? path.dirname(path.dirname(storeRoot))
      : null;
  if (!workspace) {
    throw new Error(
      "Не удалось определить workspace; разместите Store в <workspace>/openspec/ или передайте --workspace",
    );
  }
  const stat = await pathState(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}

/**
 * Клонирует отсутствующий code-репозиторий или только валидирует существующий.
 *
 * @param {object} options
 * @param {{id: string, url: string, defaultBranch: string}} options.repository
 * @param {string} options.sourceRoot
 * @param {string} options.storeId
 * @param {typeof runCommand} options.commandRunner
 */
async function connectRepository({ repository, sourceRoot, storeId, commandRunner }) {
  const repositoryRoot = path.join(sourceRoot, repository.id);
  const existing = await pathState(repositoryRoot);
  let cloned = false;
  if (!existing) {
    commandRunner(
      "git",
      [
        "clone",
        "--single-branch",
        "--no-tags",
        "--branch",
        repository.defaultBranch,
        "--",
        repository.url,
        repositoryRoot,
      ],
      { cwd: sourceRoot, sensitiveValues: [repository.url] },
    );
    cloned = true;
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
  }

  const git = inspectCheckout(repositoryRoot, repository, commandRunner);
  const pointerCreated = await ensurePointer(repositoryRoot, storeId);
  commandRunner("openspec", ["doctor", "--json"], { cwd: repositoryRoot });
  return {
    id: repository.id,
    path: repositoryRoot,
    branch: git.branch,
    revision: git.revision,
    cloned,
    pointerCreated,
    status: pointerCreated ? "needs_setup_pr" : "ready",
  };
}

/**
 * Подключает текущий компьютер к готовому Store и собирает локальный workspace.
 * OpenSpec отвечает за register/doctor, адаптер — за раскладку репозиториев и
 * минимальный pointer в каждом code-репозитории.
 *
 * @param {object} [options]
 * @param {string} [options.start] Корень центрального Store-репозитория.
 * @param {string} [options.workspace] Корень workspace; обычно определяется автоматически.
 * @param {typeof runCommand} [options.commandRunner] Переопределяется только в тестах.
 * @returns {Promise<{
 *   storeId: string,
 *   storeRoot: string,
 *   workspace: string,
 *   status: "ready" | "needs_setup_pr",
 *   repositories: Array<object>
 * }>}
 */
export async function connectProject({
  start = process.cwd(),
  workspace: requestedWorkspace,
  commandRunner = runCommand,
} = {}) {
  const storeRoot = await fs.realpath(path.resolve(start));
  const metadata = parseStoreMetadata(await readFile(storeRoot, PATHS.metadata));
  const config = parseSddConfig(await readFile(storeRoot, PATHS.sddConfig));

  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в sdd.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  if (config.openSpecVersion !== OPEN_SPEC_VERSION) {
    throw new Error(`sdd поддерживает OpenSpec ${OPEN_SPEC_VERSION}`);
  }
  const installedVersion = commandRunner("openspec", ["--version"], { cwd: storeRoot });
  if (installedVersion !== config.openSpecVersion) {
    throw new Error(`Установлен OpenSpec ${installedVersion}, ожидается ${config.openSpecVersion}`);
  }

  // Не дублируем правила Store: официальный CLI является источником ошибок.
  commandRunner(
    "openspec",
    ["store", "register", storeRoot, "--id", metadata.id, "--yes", "--json"],
    { cwd: storeRoot },
  );
  commandRunner("openspec", ["store", "doctor", metadata.id, "--json"], {
    cwd: storeRoot,
  });
  commandRunner("openspec", ["doctor", "--store", metadata.id, "--json"], {
    cwd: storeRoot,
  });

  const workspace = await resolveWorkspace(storeRoot, requestedWorkspace);
  const sourceRoot = path.join(workspace, "src");
  await fs.mkdir(sourceRoot, { recursive: true });

  const repositories = [];
  for (const repository of config.codeRepositories) {
    repositories.push(
      await connectRepository({
        repository,
        sourceRoot,
        storeId: metadata.id,
        commandRunner,
      }),
    );
  }

  return {
    storeId: metadata.id,
    storeRoot,
    workspace,
    status: repositories.some(({ pointerCreated }) => pointerCreated)
      ? "needs_setup_pr"
      : "ready",
    repositories,
  };
}
