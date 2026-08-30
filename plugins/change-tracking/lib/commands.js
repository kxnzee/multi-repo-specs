/** @fileoverview Thin native CLI adapter for Change Tracking operations. */

import {
  COMMAND_SCOPE,
  createCliProgress,
  singleValue,
} from "@openspec-orch/plugin-sdk";

import {
  CHANGE_TRACKING_RECEIPT_SOURCE,
  CHANGE_TRACKING_VERIFICATION_RESULT,
} from "./contracts.js";
import { ChangeTrackingService } from "./service.js";
import { StoreGitSync } from "./store-git-sync.js";

/** Normalizes Commander negation and SDK executor camel-case option shapes. */
function noPushRequested(options) {
  return options.noPush === true || options.push === false;
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
      implementation_revision: repository.receipt?.implementation_revision ?? null,
      source: repository.receipt?.source ?? null,
      connected: repository.connected,
      commit_available: repository.commitAvailable,
      head: repository.head,
      head_matches: repository.headMatches,
    }))),
    snapshot: status.snapshot,
    verification: status.verification,
  });
}

/** Prints the human-readable status contract. */
function printStatus(status, currentRepository, write) {
  const verificationFailed = status.verification?.current &&
    status.verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.fail;
  write(
    `${verificationFailed ? "✗" : "•"} Evidence для изменения ${status.changeId}`,
  );
  if (!status.committed) {
    write("  ⚠ Отслеживание: закоммитьте созданный служебный файл в Store");
  }
  if (currentRepository) {
    const inCycle = status.cycle.repositories.includes(currentRepository.id);
    write(
      `  ${inCycle ? "✓" : "•"} Текущий репозиторий: ${currentRepository.id} ` +
        `(${inCycle ? "участвует" : "не участвует"})`,
    );
  }
  write("");
  write(`  Implementation revisions (${status.repositories.length})`);
  for (const repository of status.repositories) {
    if (!repository.receipt) {
      write(`    • ${repository.repositoryId} — SHA не передан`);
      continue;
    }
    write(
      `    ${repository.commitAvailable === false ? "⚠" : "✓"} ` +
        `${repository.repositoryId} @ ${repository.receipt.implementation_revision}`,
    );
    if (repository.connected === false) write("      • локальный checkout не подключен");
    if (repository.commitAvailable === false) write("      ⚠ commit недоступен в checkout");
    if (repository.headMatches === false) {
      write(
        `      ⚠ текущий HEAD отличается (${repository.head})`,
      );
    }
  }
  if (status.snapshot) {
    write(
      `  ${status.snapshot.current ? "✓" : "⚠"} Версия: ` +
        `${status.snapshot.current ? "собрана" : "устарела"} ${status.snapshot.snapshot_id}`,
    );
  } else {
    write("  ⚠ Версия: ещё не собрана");
  }
  if (status.verification) {
    const passed = status.verification.current &&
      status.verification.result === CHANGE_TRACKING_VERIFICATION_RESULT.pass;
    const stale = !status.verification.current;
    write(
      `  ${stale ? "⚠" : passed ? "✓" : "✗"} Проверка: ` +
        `${stale ? "устарела" : passed ? "пройдена" : "не пройдена"}`,
    );
  } else {
    write("  ⚠ Проверка: не выполнена");
  }
}

/** Registers the public Change Tracking flow through the SDK builder. */
export function registerChangeTrackingCommands(
  commands,
  { output = console, progress = createCliProgress() } = {},
) {
  const write = (message) => output.log(message);
  const synchronize = async (context) => {
    const sync = new StoreGitSync(context);
    await progress.run(
      "Синхронизация командного состояния...",
      () => sync.pull(),
      { success: "Командное состояние обновлено" },
    );
    return sync;
  };
  const publish = async (sync, paths, message, options, { pending, success }) => {
    const result = await progress.run(
      pending,
      () => sync.publish(paths, message, { noPush: noPushRequested(options) }),
      { success },
    );
    if (!result.pushed) write("Tracking commit создан локально без push.");
  };

  commands.command("track <change-id>")
    .description("начать сбор implementation evidence по Repository Impact")
    .option("--no-push", "создать локальный tracking commit без push")
    .actionWithContext(async (context, changeId, options) => {
      const sync = await synchronize(context);
      const result = await progress.run(
        "Чтение Change и Repository Impact для evidence scope...",
        () => new ChangeTrackingService(context).track({
          changeId,
        }),
        { success: "Evidence scope определён" },
      );
      write(`Repository scope: ${result.repositoryIds.join(", ")}`);
      write(`Сбор evidence ${result.changed ? "начат" : "уже настроен"}: ` +
        result.cycle.cycleId);
      write(`Cycle Record: ${result.path}`);
      if (result.changed) {
        await publish(
          sync,
          [result.path],
          `tracking(${changeId}): track`,
          options,
          {
            pending: "Публикация evidence scope в Store...",
            success: "Evidence scope опубликован",
          },
        );
      }
    }, { scope: COMMAND_SCOPE.store });

  commands.command("done")
    .description("передать текущий SHA Code Repository в evidence изменения")
    .option("--no-push", "создать локальный tracking commit без push")
    .option("--change <change-id>", "явный Change при нескольких активных Cycles", {
      parser: singleValue,
    })
    .option("--sha <hash>", "аварийный exact commit вместо HEAD", { parser: singleValue })
    .option("--source <source>", "источник результата", {
      choices: Object.values(CHANGE_TRACKING_RECEIPT_SOURCE),
    })
    .actionWithContext(async (context, options) => {
      const sync = await synchronize(context);
      const result = await progress.run(
        "Проверка Repository, Cycle и HEAD...",
        () => new ChangeTrackingService(context).done({
          changeId: options.change,
          implementationRevision: options.sha,
          source: options.source ?? CHANGE_TRACKING_RECEIPT_SOURCE.human,
        }),
        { success: "Implementation revision зафиксирована" },
      );
      write(`${result.repositoryId} @ ${result.result.receipt.implementation_revision}`);
      if (!result.remoteReachable) {
        write("⚠ commit не найден в известных remote-tracking refs; команда может его не видеть");
      }
      if (result.snapshot) write(`Версия собрана: ${result.snapshot.snapshot_id}`);
      await publish(
        sync,
        [result.result.path],
        `tracking(${result.changeId}): done ${result.repositoryId}`,
        options,
        {
          pending: "Публикация результата в Store...",
          success: "Результат опубликован",
        },
      );
    }, { scope: COMMAND_SCOPE.store });

  commands.command("status <change-id>")
    .description("показать implementation evidence и привязанную проверку")
    .option("--json", "вывести машиночитаемый контекст Cycle и текущего Repository")
    .actionWithContext(async (context, changeId, options) => {
      await synchronize(context);
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

  commands.command("verify <result>")
    .description("зафиксировать pass/fail текущей собранной версии")
    .option("--no-push", "создать локальный tracking commit без push")
    .option("--change <change-id>", "явный Change при нескольких активных Cycles", {
      parser: singleValue,
    })
    .option("--source <source>", "источник проверки", {
      choices: [
        CHANGE_TRACKING_RECEIPT_SOURCE.human,
        CHANGE_TRACKING_RECEIPT_SOURCE.ci,
      ],
    })
    .option("--note <text>", "необязательная заметка", { parser: singleValue })
    .actionWithContext(async (context, verificationResult, options) => {
      const decisions = Object.values(CHANGE_TRACKING_VERIFICATION_RESULT);
      if (!decisions.includes(verificationResult)) {
        throw new Error("VERIFY_INVALID: result должен быть pass или fail");
      }
      const sync = await synchronize(context);
      const verified = await progress.run(
        "Проверка актуальности собранной версии...",
        () => new ChangeTrackingService(context).verifyResult({
          changeId: options.change,
          result: verificationResult,
          source: options.source ?? CHANGE_TRACKING_RECEIPT_SOURCE.human,
          note: options.note,
        }),
        { success: "Результат проверки зафиксирован" },
      );
      write(`Проверка ${verificationResult === CHANGE_TRACKING_VERIFICATION_RESULT.pass
        ? "пройдена"
        : "не пройдена"} для версии ${verified.receipt.snapshot_id}`);
      await publish(
        sync,
        [verified.path],
        `tracking(${verified.changeId}): verify ${verificationResult}`,
        options,
        {
          pending: "Публикация проверки в Store...",
          success: "Проверка опубликована",
        },
      );
    }, { scope: COMMAND_SCOPE.store });
}
