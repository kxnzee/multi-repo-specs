/** @fileoverview Пользовательский сценарий `verify`. */

import process from "node:process";

import { verifyCycle } from "../../internal/snapshot/index.js";
import { findSpecRoot } from "../../internal/shared/store.js";

/** @param {{changeId: string}} options Нормализованные CLI-параметры. */
export async function runVerify(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const result = await verifyCycle({ storeRoot, changeId: options.changeId });
  console.log(`snapshot_id: ${result.snapshot.snapshot_id}`);
  for (const [repositoryId, revision] of Object.entries(result.snapshot.implementations)) {
    console.log(`${repositoryId}: ${revision}`);
  }
  console.log("Orchestrator не выполнял checkout и не запускал проектные проверки.");
}
