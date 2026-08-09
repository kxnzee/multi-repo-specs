/** @fileoverview Проверки Store и стандартного OpenSpec Change для шага 02. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { parseSddConfig, parseStoreMetadata, sameGitRemote } from "../config/index.js";
import { validateOpenSpec } from "../explore/validation/store.js";
import { findSpecRoot } from "../explore/workspace.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";

const PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  sddConfig: "sdd.yaml",
});

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние либо `null`.
 */
async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Читает обязательный обычный файл Store.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} relativePath Относительный путь.
 * @returns {Promise<string>} UTF-8 содержимое.
 */
async function readStoreFile(projectRoot, relativePath) {
  const target = path.join(projectRoot, relativePath);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} должна быть обычным файлом`);
  }
  return fs.readFile(target, "utf8");
}

/**
 * Разрешает и проверяет центральный Store перед изменением Git.
 *
 * @param {string} start Текущий каталог внутри Store.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {Promise<{projectRoot: string, storeId: string, config: ReturnType<typeof parseSddConfig>, activeChanges: Array<{name: string}>}>} Проверенный Store.
 */
export async function resolveChangeStore(start, commandRunner) {
  const projectRoot = await findSpecRoot(start);
  const [metadataSource, configSource] = await Promise.all([
    readStoreFile(projectRoot, PATHS.metadata),
    readStoreFile(projectRoot, PATHS.sddConfig),
  ]);
  const metadata = parseStoreMetadata(metadataSource);
  const config = parseSddConfig(configSource);
  if (config.storeRepository.id !== metadata.id) {
    throw new Error("Store ID в sdd.yaml не совпадает с Store metadata");
  }
  if (!metadata.remote || !sameGitRemote(config.storeRepository.url, metadata.remote)) {
    throw new Error("URL role: store не совпадает с Store metadata");
  }
  const activeChanges = validateOpenSpec(
    projectRoot,
    metadata.id,
    config.openSpecVersion,
    commandRunner,
  );
  return { projectRoot, storeId: metadata.id, config, activeChanges };
}

/**
 * Проверяет локальное состояние каталога Change.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} changeId Change ID.
 * @returns {Promise<{exists: boolean, changeRoot: string, proposalExists: boolean}>} Состояние Change.
 */
export async function inspectChangeDirectory(projectRoot, changeId) {
  const changeRoot = path.join(projectRoot, "openspec", "changes", changeId);
  const rootStat = await pathState(changeRoot);
  if (!rootStat) return { exists: false, changeRoot, proposalExists: false };
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`needs_recovery: каталог Change должен быть обычным: ${changeRoot}`);
  }

  const metadataPath = path.join(changeRoot, ".openspec.yaml");
  const metadataStat = await pathState(metadataPath);
  if (!metadataStat?.isFile() || metadataStat.isSymbolicLink()) {
    throw new Error("needs_recovery: Change не содержит обычный .openspec.yaml");
  }
  let metadata;
  try {
    metadata = parseYaml(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`needs_recovery: некорректный .openspec.yaml: ${error.message}`);
  }
  if (metadata?.schema !== "spec-driven" || metadata.skip_specs === true) {
    throw new Error("needs_recovery: Change должен использовать полную схему spec-driven");
  }

  for (const artifact of ["specs", "design.md", "tasks.md"]) {
    if (await pathState(path.join(changeRoot, artifact))) {
      throw new Error(`needs_recovery: шаг 02 уже пройден, найден последующий артефакт ${artifact}`);
    }
  }
  const proposalPath = path.join(changeRoot, "proposal.md");
  const proposalStat = await pathState(proposalPath);
  if (proposalStat && (!proposalStat.isFile() || proposalStat.isSymbolicLink())) {
    throw new Error("needs_recovery: proposal.md должен быть обычным файлом");
  }
  return { exists: true, changeRoot, proposalExists: Boolean(proposalStat) };
}

/**
 * Проверяет JSON успешного `openspec new change`.
 *
 * @param {import("../shared/types.js").OpenSpecResponse} payload Ответ OpenSpec.
 * @param {{projectRoot: string, storeId: string, changeId: string, changeRoot: string}} expected Ожидаемая identity.
 * @returns {void}
 */
export function assertCreatedChange(payload, expected) {
  assertOpenSpecRoot(
    payload.root,
    { path: expected.projectRoot, storeId: expected.storeId, source: "store" },
    "openspec new change",
  );
  const change = payload.change;
  if (
    change?.id !== expected.changeId ||
    change.schema !== "spec-driven" ||
    path.resolve(change.path ?? "") !== expected.changeRoot ||
    path.resolve(change.metadataPath ?? "") !== path.join(expected.changeRoot, ".openspec.yaml")
  ) {
    throw new Error("openspec new change вернула другой Change, путь или schema");
  }
}

/**
 * Получает и проверяет стандартный статус Change.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} storeId Store ID.
 * @param {string} changeId Change ID.
 * @param {string} changeRoot Ожидаемый каталог Change.
 * @param {boolean} proposalExists Существует ли Proposal.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель OpenSpec.
 * @returns {import("../shared/types.js").OpenSpecResponse} Проверенный статус.
 */
export function readChangeStatus(
  projectRoot,
  storeId,
  changeId,
  changeRoot,
  proposalExists,
  commandRunner,
) {
  const status = runOpenSpecJson(
    commandRunner,
    ["status", "--change", changeId, "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(
    status.root,
    { path: projectRoot, storeId, source: "store" },
    "openspec status",
  );
  if (
    status.changeName !== changeId ||
    status.schemaName !== "spec-driven" ||
    path.resolve(status.changeRoot ?? "") !== changeRoot ||
    !Array.isArray(status.artifacts)
  ) {
    throw new Error("openspec status вернула другой Change, путь или schema");
  }
  const artifacts = new Map(status.artifacts.map((artifact) => [artifact?.id, artifact]));
  const proposal = artifacts.get("proposal");
  if (
    proposal?.outputPath !== "proposal.md" ||
    (proposalExists && proposal.status !== "done") ||
    (!proposalExists && proposal.status !== "ready")
  ) {
    throw new Error("openspec status вернула неожиданный статус Proposal");
  }
  for (const artifactId of ["specs", "design", "tasks"]) {
    const artifact = artifacts.get(artifactId);
    if (!artifact || ["done", "skipped"].includes(artifact.status)) {
      throw new Error(`needs_recovery: неожиданный статус последующего артефакта ${artifactId}`);
    }
  }
  return status;
}
