/** @fileoverview Preflight и recovery-проверки состояния OpenSpec Store для `init`. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseOrchestratorConfig } from "../config/index.js";
import { lstatOrNull } from "../shared/files.js";
import { sameGitRemote } from "../shared/git.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));

export const INIT_PATHS = Object.freeze({
  metadata: path.join(".openspec-store", "store.yaml"),
  openSpecConfig: path.join("openspec", "config.yaml"),
  alternateOpenSpecConfig: path.join("openspec", "config.yml"),
  orchestratorConfig: "openspec-orch.yaml",
  orchestratorTemplate: path.join(MODULE_ROOT, "openspec-orch.yaml"),
});

/**
 * Проверяет обязательный обычный файл.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} relativePath Относительный путь.
 * @param {string[]} issues Получатель диагностик.
 * @returns {Promise<void>}
 */
async function inspectRequiredFile(projectRoot, relativePath, issues) {
  const stat = await lstatOrNull(path.join(projectRoot, relativePath));
  if (!stat) issues.push(`отсутствует ${relativePath}`);
  else if (!stat.isFile() || stat.isSymbolicLink()) {
    issues.push(`${relativePath} не является обычным файлом`);
  }
}

/**
 * Проверяет завершённый init только по автономному runtime-контракту Core.
 * Исходный Template для повторного запуска не требуется; ожидаемые пути agent pack
 * определяет уже пересчитанный `templatePlan.agent` для запрошенного `--agent`.
 *
 * @param {object} options Параметры проверки.
 * @param {string} options.projectRoot Корень Store.
 * @param {string} options.storeId Ожидаемый Store ID.
 * @param {import("../template/types.js").TemplateAgent} options.agent Ожидаемый Template agent mapping.
 * @param {{remote: string | undefined}} options.metadata Store metadata.
 * @returns {Promise<ReturnType<typeof parseOrchestratorConfig>>} Проверенная конфигурация.
 */
export async function assertInitializationComplete({ projectRoot, storeId, agent, metadata }) {
  const issues = [];
  let config;
  const configStat = await lstatOrNull(path.join(projectRoot, INIT_PATHS.orchestratorConfig));
  if (!configStat?.isFile() || configStat.isSymbolicLink()) {
    issues.push(`отсутствует обычный файл ${INIT_PATHS.orchestratorConfig}`);
  } else {
    try {
      config = parseOrchestratorConfig(
        await fs.readFile(path.join(projectRoot, INIT_PATHS.orchestratorConfig), "utf8"),
      );
      if (config.storeRepository.id !== storeId) {
        issues.push(`Store ID в ${INIT_PATHS.orchestratorConfig} не совпадает с Store metadata`);
      }
      if (!metadata.remote || !sameGitRemote(config.storeRepository.remote, metadata.remote)) {
        issues.push(`URL role: store в ${INIT_PATHS.orchestratorConfig} не совпадает с Store metadata`);
      }
    } catch (error) {
      issues.push(`${INIT_PATHS.orchestratorConfig}: ${error.message}`);
    }
  }

  await inspectRequiredFile(projectRoot, agent.instructionsFile, issues);
  const commandsStat = await lstatOrNull(path.join(projectRoot, agent.commandsDirectory));
  if (!commandsStat?.isDirectory() || commandsStat.isSymbolicLink()) {
    issues.push(`${agent.commandsDirectory}/ не является обычным каталогом`);
  }
  await inspectRequiredFile(projectRoot, INIT_PATHS.openSpecConfig, issues);
  for (const relativePath of ["openspec/specs", "openspec/changes/archive"]) {
    const stat = await lstatOrNull(path.join(projectRoot, relativePath));
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      issues.push(`${relativePath}/ не является обычным каталогом`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `needs_recovery: завершено: создана Store metadata; не завершено: ${issues.join("; ")}. ` +
        "Автоматический ремонт не выполняется; файлы проекта не изменены",
    );
  }
  return config;
}
