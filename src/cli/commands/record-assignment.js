/** @fileoverview Пользовательский сценарий `record assignment`. */

import process from "node:process";
import { confirm as promptConfirm } from "@inquirer/prompts";

import { recordAssignment } from "../../internal/receipt/assignment.js";
import { runCommand } from "../../internal/shared/command.js";
import { resolveCommandStoreRoot } from "../../internal/shared/store.js";
import { stopProgress } from "../progress.js";

/** @param {object} preview Проверенный preview Result Receipt. */
async function confirmRecordAssignment(preview) {
  const { receipt } = preview;
  console.log(`repository_id: ${receipt.repository_id}`);
  console.log(`implementation_revision: ${receipt.implementation_revision}`);
  console.log(`status: ${receipt.status}`);
  console.log(`source: ${receipt.source}`);
  if (preview.existing) console.log("Предупреждение: текущий Result Receipt будет заменён с сохранением истории.");
  if (preview.head !== receipt.implementation_revision) {
    console.log(`Предупреждение: HEAD checkout отличается (${preview.head}).`);
  }
  stopProgress();
  return promptConfirm({ message: "Записать Result Receipt?", default: false });
}

/** @param {object} options Нормализованные CLI-параметры. */
export async function runRecordAssignment(options) {
  const storeRoot = await resolveCommandStoreRoot(process.cwd(), runCommand);
  const result = await recordAssignment({
    storeRoot,
    ...options,
    confirm: confirmRecordAssignment,
  });
  if (result.status === "cancelled") {
    console.log("Отменено пользователем; Result Receipt не записан.");
    return;
  }
  console.log(`Result Receipt ${result.status === "created" ? "создан" : "заменён"}: ${result.receipt.receipt_id}`);
}
