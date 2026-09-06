/** @fileoverview Deterministic pathname replacement after an actual filesystem check. */

import { promises as fs } from "node:fs";

/** Replaces a checked file with a distinct inode before returning its old lstat. */
export async function replaceAfterCheck(t, target, content) {
  const canonical = await fs.realpath(target);
  const original = fs.lstat.bind(fs);
  let replaced = false;
  t.mock.method(fs, "lstat", async (...args) => {
    const stat = await original(...args);
    if (args[0] === canonical && !replaced) {
      replaced = true;
      await fs.rename(canonical, `${canonical}.checked`);
      await fs.writeFile(canonical, content);
    }
    return stat;
  });
  return () => replaced;
}
