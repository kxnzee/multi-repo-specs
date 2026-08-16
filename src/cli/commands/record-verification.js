/** @fileoverview Пользовательский сценарий `record verification`. */

import process from "node:process";
import { confirm as promptConfirm } from "@inquirer/prompts";

import { recordVerification } from "../../internal/receipt/verification.js";
import { findSpecRoot } from "../../internal/shared/store.js";
import { stopProgress } from "../progress.js";

/** @param {object} preview Проверенный preview Verification Receipt. */
async function confirmRecordVerification(preview) {
  const { receipt } = preview;
  console.log(`snapshot_id: ${receipt.snapshot_id}`);
  console.log(`result: ${receipt.result}`);
  console.log(`source: ${receipt.source}`);
  if (preview.existing) console.log("Предупреждение: текущий Verification Receipt будет заменён с сохранением истории.");
  stopProgress();
  return promptConfirm({ message: "Записать Verification Receipt?", default: false });
}
/** @param {object} options Нормализованные CLI-параметры. */
export async function runRecordVerification(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const result = await recordVerification({
    storeRoot,
    ...options,
    confirm: confirmRecordVerification,
  });
  if (result.status === "cancelled") {
    console.log("Отменено пользователем; Verification Receipt не записан.");
    return;
  }
  console.log(
    `Verification Receipt ${result.status === "created" ? "создан" : "заменён"}: ${result.receipt.receipt_id}`,
  );
}
