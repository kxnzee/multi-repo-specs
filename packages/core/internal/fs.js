/** @fileoverview Общие безопасные filesystem helpers Core. */

import { promises as fs } from "node:fs";

/** Возвращает lstat либо null только для отсутствующего path. */
export async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Создаёт каталог с защитой от конкурентного mkdir и возвращает его lstat. */
export async function ensureDirectory(target, { mode } = {}) {
  let stat = await lstatOrNull(target);
  if (!stat) {
    try {
      await fs.mkdir(target, mode === undefined ? undefined : { mode });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    stat = await fs.lstat(target);
  }
  return stat;
}
