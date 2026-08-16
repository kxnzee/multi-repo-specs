/** @fileoverview Разрешение и локальное сохранение путей multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { lstatOrNull, writeFileAtomic } from "./files.js";
import { isRecord } from "./schema.js";

const STATE_CONTRACT_VERSION = 1;
const STATE_DIRECTORY = ".openspec-orch";
const STATE_FILE = "state.json";

/**
 * Читает версионированный `.openspec-orch/state.json`; отсутствие файла — не ошибка.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @returns {Promise<{workspace: string | null}>} Проверенное локальное состояние.
 */
async function readLocalState(storeRoot) {
  const statePath = path.join(storeRoot, STATE_DIRECTORY, STATE_FILE);
  let source;
  try {
    source = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { workspace: null };
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`.openspec-orch/state.json повреждён: ${error.message}`);
  }
  if (!isRecord(payload)) throw new Error(".openspec-orch/state.json должен быть объектом");
  if (payload.contract_version !== STATE_CONTRACT_VERSION) {
    throw new Error(".openspec-orch/state.json: неподдерживаемая contract_version");
  }
  if (payload.workspace !== null && typeof payload.workspace !== "string") {
    throw new Error(".openspec-orch/state.json: workspace должен быть строкой или null");
  }
  return { workspace: payload.workspace ?? null };
}

/**
 * Атомарно записывает локальный workspace в `.openspec-orch/state.json`.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} workspace Канонический абсолютный путь workspace.
 * @returns {Promise<void>}
 */
export async function rememberWorkspace(storeRoot, workspace) {
  const directory = path.join(storeRoot, STATE_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  const payload = { contract_version: STATE_CONTRACT_VERSION, workspace };
  await writeFileAtomic(path.join(directory, STATE_FILE), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Определяет стандартный workspace для Store в раскладке `<workspace>/<store-id>`.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} storeId Store ID из проверенных metadata.
 * @returns {string | null} Путь workspace либо `null` для нестандартной раскладки.
 */
export function inferStandardWorkspace(storeRoot, storeId) {
  const workspace = path.dirname(storeRoot);
  return (
    path.basename(storeRoot) === storeId &&
    path.basename(workspace) !== "openspec" &&
    path.dirname(workspace) !== workspace
  ) ? workspace : null;
}

/**
 * Определяет общий workspace по явному аргументу, локальному state.json
 * или стандартной раскладке `<workspace>/<store-id>`.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} storeId Store ID из проверенных metadata.
 * @param {string | undefined} requestedWorkspace Явно переданный workspace.
 * @param {boolean} [useWorkspaceState] Читать локальный `.openspec-orch/state.json`.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
export async function resolveWorkspace(
  storeRoot,
  storeId,
  requestedWorkspace,
  useWorkspaceState = true,
) {
  const state = useWorkspaceState ? await readLocalState(storeRoot) : { workspace: null };
  const storedWorkspace = state.workspace ? path.resolve(state.workspace) : "";
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : storedWorkspace || inferStandardWorkspace(storeRoot, storeId);
  if (!workspace) {
    throw new Error(
      `Не удалось определить workspace; разместите Store как <workspace>/${storeId} ` +
      "или один раз выполните openspec-orch connect --workspace <path>",
    );
  }
  const stat = await lstatOrNull(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    if (storedWorkspace) {
      throw new Error(
        `Сохранённый workspace недоступен: ${workspace}; повторите openspec-orch connect --workspace <path>`,
      );
    }
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}

/**
 * Определяет workspace по стандартному checkout `<workspace>/src/<repository-id>`.
 * `openspec-orch connect` всегда размещает Code Repositories именно в этой структуре, включая
 * сценарий с явно заданным workspace и Store вне `<workspace>/openspec/`.
 *
 * @param {string} repositoryRoot Канонический корень Code Repository.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
export async function resolveCodeWorkspace(repositoryRoot) {
  const sourceRoot = path.dirname(repositoryRoot);
  if (path.basename(sourceRoot) !== "src") {
    throw new Error(`Code Repository должен находиться в <workspace>/src/: ${repositoryRoot}`);
  }
  const workspace = path.dirname(sourceRoot);
  const stat = await lstatOrNull(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}
