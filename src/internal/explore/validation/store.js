/** @fileoverview Проверка оригинального OpenSpec action для Explore. */

import path from "node:path";

import { lstatOrNull } from "../../shared/files.js";

/**
 * Проверяет наличие оригинальной команды `/opsx-explore` выбранного агента.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {{id: string, commandsDirectory: string}} agent Runtime mapping.
 * @returns {Promise<void>}
 */
export async function validateOpenSpecAction(projectRoot, agent) {
  const relativePath = path.join(agent.commandsDirectory, "opsx-explore.md");
  const target = path.join(projectRoot, relativePath);
  const stat = await lstatOrNull(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `Не установлено оригинальное действие OpenSpec ${relativePath}; ` +
        `восстановите agent pack для ${agent.id} поддерживаемым способом OpenSpec`,
    );
  }
}
