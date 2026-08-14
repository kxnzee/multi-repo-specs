/** @fileoverview Проверка оригинального OpenSpec action для Explore. */

import { promises as fs } from "node:fs";
import path from "node:path";

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
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `Не установлено оригинальное действие OpenSpec ${relativePath}; ` +
        `восстановите agent pack для ${agent.id} поддерживаемым способом OpenSpec`,
    );
  }
}
