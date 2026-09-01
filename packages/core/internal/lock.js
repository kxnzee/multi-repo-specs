/** @fileoverview Межпроцессная fail-closed блокировка Core operations. */

import { promises as fs } from "node:fs";
import path from "node:path";

/** Выполняет операцию с эксклюзивным directory lock без stale-lock recovery. */
export class FailClosedLock {
  async run(lockPath, operation, { busyCode = "STATE_BUSY" } = {}) {
    if (typeof lockPath !== "string" || !path.isAbsolute(lockPath)) {
      throw new Error("LOCK_INVALID: lockPath должен быть абсолютным путём");
    }
    if (typeof operation !== "function") {
      throw new Error("LOCK_INVALID: operation должна быть функцией");
    }
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") {
        throw Object.assign(
          new Error(`${busyCode}: состояние уже изменяется другой командой; повторите вызов`),
          { code: busyCode },
        );
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await fs.rmdir(lockPath);
    }
  }
}

/** Общая fail-closed блокировка нового Core. */
export const locks = Object.freeze(new FailClosedLock());
