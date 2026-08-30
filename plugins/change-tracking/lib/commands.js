/** @fileoverview Thin native CLI adapter for Change Tracking operations. */

import { confirm } from "@inquirer/prompts";
import {
  collectValues,
  COMMAND_SCOPE,
  createCliProgress,
  singleValue,
} from "@openspec-orch/plugin-sdk";

import {
  CHANGE_TRACKING_RECEIPT_SOURCE,
  CHANGE_TRACKING_REPOSITORY_STATE,
  CHANGE_TRACKING_RESULT_STATUS,
  CHANGE_TRACKING_VERIFICATION_RESULT,
  CHANGE_TRACKING_WRITE_STATUS,
} from "./contracts.js";
import { ChangeTrackingService } from "./service.js";

/** Prints and confirms one Cycle Record preview. */
async function confirmAssign(preview, write, prompt) {
  write(`change_id: ${preview.changeId}`);
  write(`planning_revision: ${preview.planningRevision}`);
  write(`repositories: ${preview.repositories.join(", ")}`);
  write(`Cycle Record: ${preview.path}`);
  if (preview.kind === "replace") {
    write(`Существующий cycle_id ${preview.existing.cycleId} перестанет быть текущим.`);
    write("Будет создан новый cycle_id.");
  }
  write("Core не создаст Git commit; закоммитьте файл самостоятельно.");
  return prompt({ message: "Записать Cycle Record?", default: false });
}

/** Prints and confirms one Result Receipt preview. */
async function confirmAssignment(preview, write, prompt) {
  const { receipt } = preview;
  write(`repository_id: ${receipt.repository_id}`);
  write(`implementation_revision: ${receipt.implementation_revision}`);
  write(`status: ${receipt.status}`);
  write(`source: ${receipt.source}`);
  if (preview.existing) {
    write(
      "Предупреждение: текущий Result Receipt будет заменён с сохранением истории.",
    );
  }
  if (preview.head !== receipt.implementation_revision) {
    write(`Предупреждение: HEAD checkout отличается (${preview.head}).`);
  }
  return prompt({ message: "Записать Result Receipt?", default: false });
}

/** Prints and confirms one Verification Receipt preview. */
async function confirmVerification(preview, write, prompt) {
  const { receipt } = preview;
  write(`snapshot_id: ${receipt.snapshot_id}`);
  write(`result: ${receipt.result}`);
  write(`source: ${receipt.source}`);
  if (preview.existing) {
    write(
      "Предупреждение: текущий Verification Receipt будет заменён с сохранением истории.",
    );
  }
  return prompt({ message: "Записать Verification Receipt?", default: false });
}

/** Показывает подготовительные проверки, но убирает spinner до интерактивного prompt. */
async function runBeforePrompt(progress, message, success, operation) {
  let prepared = false;
  const finishPreparation = () => {
    if (prepared) return;
    progress.succeed(success);
    prepared = true;
  };
  progress.start(message);
  try {
    const result = await operation(finishPreparation);
    finishPreparation();
    return result;
  } catch (error) {
    progress.fail(`${message}: ошибка`);
    throw error;
  }
}

/** Produces the stable agent-facing status JSON. */
export function formatStatusJson(status, currentRepository) {
  return Object.freeze({
    change_id: status.changeId,
    cycle_id: status.cycle.cycleId,
    planning_revision: status.cycle.planningRevision,
    repositories: status.cycle.repositories,
    committed: status.committed,
    current_repository: currentRepository
      ? Object.freeze({
        repository_id: currentRepository.id,
        role: currentRepository.role,
        path: currentRepository.path,
        in_cycle: status.cycle.repositories.includes(currentRepository.id),
      })
      : null,
    results: Object.freeze(status.repositories.map((repository) => Object.freeze({
      repository_id: repository.repositoryId,
      status: repository.state,
      implementation_revision: repository.receipt?.implementation_revision ?? null,
      source: repository.receipt?.source ?? null,
      commit_available: repository.commitAvailable,
      head: repository.head,
      head_matches: repository.headMatches,
    }))),
    snapshot: status.snapshot,
    verification: status.verification,
    next_action: status.nextAction,
  });
}

/** Переводит machine state только для human status; JSON contract не меняется. */
function resultStateLabel(state) {
  return {
    [CHANGE_TRACKING_RESULT_STATUS.blocked]: "заблокирован",
    [CHANGE_TRACKING_REPOSITORY_STATE.commitUnavailable]: "commit недоступен",
    [CHANGE_TRACKING_RESULT_STATUS.completed]: "завершён",
    [CHANGE_TRACKING_RESULT_STATUS.failed]: "ошибка",
    [CHANGE_TRACKING_REPOSITORY_STATE.missing]: "результат не записан",
  }[state] ?? state;
}

/** Prints the human-readable status contract. */
function printStatus(status, currentRepository, write) {
  const verificationFailed = status.verification?.current &&
    status.verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.fail;
  const complete = status.nextAction === "готово" && !verificationFailed;
  write(
    `${verificationFailed ? "✗" : complete ? "✓" : "⚠"} Change ${status.changeId} — ` +
      `${verificationFailed ? "проверка не пройдена" : complete ? "готов" : "требуется действие"}`,
  );
  write(`  Cycle: ${status.cycle.cycleId}`);
  write(`  Planning revision: ${status.cycle.planningRevision}`);
  write(`  ${status.committed ? "✓" : "⚠"} Cycle Record: ` +
    `${status.committed ? "закоммичен" : "не закоммичен"}`);
  if (currentRepository) {
    const inCycle = status.cycle.repositories.includes(currentRepository.id);
    write(
      `  ${inCycle ? "✓" : "•"} Текущий Repository: ${currentRepository.id} ` +
        `(${inCycle ? "в Cycle" : "вне Cycle"})`,
    );
  }
  write("");
  write(`  Репозитории (${status.repositories.length})`);
  for (const repository of status.repositories) {
    const icon = repository.state === CHANGE_TRACKING_RESULT_STATUS.completed
      ? "✓"
      : [
          CHANGE_TRACKING_RESULT_STATUS.failed,
          CHANGE_TRACKING_REPOSITORY_STATE.commitUnavailable,
        ].includes(repository.state) ? "✗" : "⚠";
    const state = resultStateLabel(repository.state);
    if (!repository.receipt) {
      write(`    ${icon} ${repository.repositoryId} — ${state}`);
      continue;
    }
    write(
      `    ${icon} ${repository.repositoryId} — ${state} @ ` +
        `${repository.receipt.implementation_revision} (${repository.receipt.source})`,
    );
    if (repository.headMatches === false) {
      write(
        `      ⚠ HEAD отличается (${repository.head}); Receipt сохраняет точный SHA`,
      );
    }
  }
  if (status.snapshot) {
    write(
      `  ${status.snapshot.current ? "✓" : "⚠"} Snapshot: ${status.snapshot.snapshot_id} ` +
        `(${status.snapshot.current ? "актуален" : "устарел"})`,
    );
  }
  if (status.verification) {
    const passed = status.verification.current &&
      status.verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.pass;
    write(
      `  ${passed ? "✓" : "✗"} Проверка: ` +
        `${status.verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.pass
          ? "пройдена"
          : "не пройдена"} ` +
        `(${status.verification.source}, ` +
        `${status.verification.current ? "актуальна" : "устарела"})`,
    );
  }
  write("");
  write(`  → Далее: ${status.nextAction}`);
}

/** Registers the preserved root command grammar through the public SDK builder. */
export function registerChangeTrackingCommands(
  commands,
  { output = console, progress = createCliProgress(), prompt = confirm } = {},
) {
  const write = (message) => output.log(message);
  const confirmCycle = (preview) => confirmAssign(preview, write, prompt);
  const confirmResult = (preview) => confirmAssignment(preview, write, prompt);
  const confirmReceipt = (preview) => confirmVerification(preview, write, prompt);
  commands.command("assign <change-id>")
    .description("создать или подтвердить текущий Cycle для change-id")
    .option("--repo <repository-id>", "repository-id из состава Cycle", {
      parser: collectValues,
      required: true,
    })
    .actionWithContext(async (context, changeId, options) => {
      const result = await runBeforePrompt(
        progress,
        "Проверка Change и repositories перед созданием Cycle...",
        "Данные Cycle проверены",
        (prepared) => new ChangeTrackingService(context).assign({
          changeId,
          repositoryIds: options.repo,
          confirm: async (preview) => {
            prepared();
            return confirmCycle(preview);
          },
        }),
      );
      if (result.status === CHANGE_TRACKING_WRITE_STATUS.cancelled) {
        write("Отменено пользователем; Cycle Record не записан.");
      } else if (result.status === "unchanged") {
        write(`Cycle не изменился: ${result.cycle.cycleId}`);
        write(`Cycle Record: ${result.path}`);
      } else {
        write(
          `Cycle Record ${result.status === CHANGE_TRACKING_WRITE_STATUS.created
            ? "создан"
            : "заменён"}: ` +
            result.cycle.cycleId,
        );
        write(`Cycle Record: ${result.path}`);
        write(
          "Закоммитьте файл обычным процессом Git; до коммита record и verify недоступны.",
        );
      }
    }, { scope: COMMAND_SCOPE.store });

  commands.command("status <change-id>")
    .description("показать текущий Cycle Record и следующее действие")
    .option("--json", "вывести машиночитаемый контекст Cycle и текущего Repository")
    .actionWithContext(async (context, changeId, options) => {
      const status = await progress.run(
        `Проверка текущего состояния Change ${changeId}...`,
        () => new ChangeTrackingService(context).status(changeId),
        { success: `Состояние Change ${changeId} проверено` },
      );
      if (options.json) {
        write(JSON.stringify(formatStatusJson(status, context.invocation), null, 2));
      } else {
        printStatus(status, context.invocation, write);
      }
    }, { scope: COMMAND_SCOPE.store, requireBinding: false });

  const record = commands.command("record")
    .description("записать внешний результат в локальное состояние");
  record.command("assignment <change-id>")
    .description("записать Result Receipt одного Code Repository")
    .option("--repo <repository-id>", "repository-id из текущего Cycle", {
      parser: singleValue,
      required: true,
    })
    .option("--commit <sha>", "точный commit результата", {
      parser: singleValue,
      required: true,
    })
    .option("--status <status>", "статус результата", {
      choices: Object.values(CHANGE_TRACKING_RESULT_STATUS),
      required: true,
    })
    .option("--source <source>", "источник результата", {
      choices: Object.values(CHANGE_TRACKING_RECEIPT_SOURCE),
      required: true,
    })
    .option("--note <text>", "необязательная заметка", { parser: singleValue })
    .actionWithContext(async (context, changeId, options) => {
      const result = await runBeforePrompt(
        progress,
        "Проверка Cycle, Repository и commit перед записью Result Receipt...",
        "Данные Result Receipt проверены",
        (prepared) => new ChangeTrackingService(context).recordAssignment({
          changeId,
          repositoryId: options.repo,
          implementationRevision: options.commit,
          status: options.status,
          source: options.source,
          note: options.note,
          confirm: async (preview) => {
            prepared();
            return confirmResult(preview);
          },
        }),
      );
      if (result.status === CHANGE_TRACKING_WRITE_STATUS.cancelled) {
        write("Отменено пользователем; Result Receipt не записан.");
      } else {
        write(
          `Result Receipt ${result.status === CHANGE_TRACKING_WRITE_STATUS.created
            ? "создан"
            : "заменён"}: ` +
            result.receipt.receipt_id,
        );
      }
    }, { scope: COMMAND_SCOPE.store });

  commands.command("verify <change-id>")
    .description("вычислить Snapshot текущих completed Result Receipts")
    .actionWithContext(async (context, changeId) => {
      const result = await progress.run(
        `Проверка Result Receipts и построение Snapshot для ${changeId}...`,
        () => new ChangeTrackingService(context).verify(changeId),
        { success: `Snapshot для ${changeId} построен` },
      );
      write(`snapshot_id: ${result.snapshot.snapshot_id}`);
      for (const [repositoryId, revision] of Object.entries(result.snapshot.implementations)) {
        write(`${repositoryId}: ${revision}`);
      }
      write("Orchestrator не выполнял checkout и не запускал проектные проверки.");
    }, { scope: COMMAND_SCOPE.store });

  record.command("verification <change-id>")
    .description("записать Verification Receipt последнего текущего Snapshot")
    .option("--result <result>", "результат внешней проверки", {
      choices: Object.values(CHANGE_TRACKING_VERIFICATION_RESULT),
      required: true,
    })
    .option("--source <source>", "источник результата", {
      choices: Object.values(CHANGE_TRACKING_RECEIPT_SOURCE),
      required: true,
    })
    .option("--note <text>", "необязательная заметка", { parser: singleValue })
    .actionWithContext(async (context, changeId, options) => {
      const result = await runBeforePrompt(
        progress,
        "Проверка Snapshot перед записью Verification Receipt...",
        "Данные Verification Receipt проверены",
        (prepared) => new ChangeTrackingService(context).recordVerification({
          changeId,
          result: options.result,
          source: options.source,
          note: options.note,
          confirm: async (preview) => {
            prepared();
            return confirmReceipt(preview);
          },
        }),
      );
      if (result.status === CHANGE_TRACKING_WRITE_STATUS.cancelled) {
        write("Отменено пользователем; Verification Receipt не записан.");
      } else {
        write(
          `Verification Receipt ${result.status === CHANGE_TRACKING_WRITE_STATUS.created
            ? "создан"
            : "заменён"}: ` +
            result.receipt.receipt_id,
        );
      }
    }, { scope: COMMAND_SCOPE.store });
}
