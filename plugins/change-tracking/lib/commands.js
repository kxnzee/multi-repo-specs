/** @fileoverview Thin native CLI adapter for Change Tracking operations. */

import { confirm } from "@inquirer/prompts";

import { ChangeTrackingService } from "./service.js";

/** Collects a repeatable Commander option without exposing Commander to the Plugin. */
function collectValues(value, previous = []) {
  return [...previous, value];
}

/** Rejects a repeated scalar option. */
function singleValue(value, previous) {
  if (previous !== undefined) throw new Error("опцию можно указать только один раз");
  return value;
}

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

/** Prints the human-readable status contract. */
function printStatus(status, currentRepository, write) {
  write(`change_id: ${status.changeId}`);
  write(`cycle_id: ${status.cycle.cycleId}`);
  write(`planning_revision: ${status.cycle.planningRevision}`);
  write(`repositories: ${status.cycle.repositories.join(", ")}`);
  write(`committed: ${status.committed ? "да" : "нет"}`);
  if (currentRepository) {
    write(
      `current_repository: ${currentRepository.id} ` +
        `(in_cycle: ${status.cycle.repositories.includes(currentRepository.id) ? "да" : "нет"})`,
    );
  }
  if (!status.committed) write("Предупреждение: Cycle Record ещё не закоммичен.");
  write("Результаты:");
  for (const repository of status.repositories) {
    if (!repository.receipt) {
      write(`  ${repository.repositoryId}: ${repository.state}`);
      continue;
    }
    write(
      `  ${repository.repositoryId}: ${repository.state} @ ` +
        `${repository.receipt.implementation_revision} (source: ${repository.receipt.source})`,
    );
    if (repository.headMatches === false) {
      write(
        `    info: HEAD checkout отличается (${repository.head}); Receipt сохраняет точный SHA.`,
      );
    }
  }
  if (status.snapshot) {
    write(
      `snapshot_id: ${status.snapshot.snapshot_id} ` +
        `(current: ${status.snapshot.current ? "да" : "нет"})`,
    );
  }
  if (status.verification) {
    write(
      `verification: ${status.verification.result} ` +
        `(source: ${status.verification.source}, ` +
        `current: ${status.verification.current ? "да" : "нет"})`,
    );
  }
  write(`следующее действие: ${status.nextAction}`);
}

/** Registers the preserved root command grammar through the public SDK builder. */
export function registerChangeTrackingCommands(
  commands,
  { output = console, prompt = confirm, serviceFactory = (context) => new ChangeTrackingService(context) } = {},
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
      const result = await serviceFactory(context).assign({
        changeId,
        repositoryIds: options.repo,
        confirm: confirmCycle,
      });
      if (result.status === "cancelled") {
        write("Отменено пользователем; Cycle Record не записан.");
      } else if (result.status === "unchanged") {
        write(`Cycle не изменился: ${result.cycle.cycleId}`);
        write(`Cycle Record: ${result.path}`);
      } else {
        write(
          `Cycle Record ${result.status === "created" ? "создан" : "заменён"}: ` +
            result.cycle.cycleId,
        );
        write(`Cycle Record: ${result.path}`);
        write(
          "Закоммитьте файл обычным процессом Git; до коммита record и verify недоступны.",
        );
      }
    }, { scope: "store" });

  commands.command("status <change-id>")
    .description("показать текущий Cycle Record и следующее действие")
    .option("--json", "вывести машиночитаемый контекст Cycle и текущего Repository")
    .actionWithContext(async (context, changeId, options) => {
      const status = await serviceFactory(context).status(changeId);
      if (options.json) {
        write(JSON.stringify(formatStatusJson(status, context.invocation), null, 2));
      } else {
        printStatus(status, context.invocation, write);
      }
    }, { scope: "store" });

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
      choices: ["completed", "failed", "blocked"],
      required: true,
    })
    .option("--source <source>", "источник результата", {
      choices: ["human", "agent", "ci"],
      required: true,
    })
    .option("--note <text>", "необязательная заметка", { parser: singleValue })
    .actionWithContext(async (context, changeId, options) => {
      const result = await serviceFactory(context).recordAssignment({
        changeId,
        repositoryId: options.repo,
        implementationRevision: options.commit,
        status: options.status,
        source: options.source,
        note: options.note,
        confirm: confirmResult,
      });
      if (result.status === "cancelled") {
        write("Отменено пользователем; Result Receipt не записан.");
      } else {
        write(
          `Result Receipt ${result.status === "created" ? "создан" : "заменён"}: ` +
            result.receipt.receipt_id,
        );
      }
    }, { scope: "store" });

  commands.command("verify <change-id>")
    .description("вычислить Snapshot текущих completed Result Receipts")
    .actionWithContext(async (context, changeId) => {
      const result = await serviceFactory(context).verify(changeId);
      write(`snapshot_id: ${result.snapshot.snapshot_id}`);
      for (const [repositoryId, revision] of Object.entries(result.snapshot.implementations)) {
        write(`${repositoryId}: ${revision}`);
      }
      write("Orchestrator не выполнял checkout и не запускал проектные проверки.");
    }, { scope: "store" });

  record.command("verification <change-id>")
    .description("записать Verification Receipt последнего текущего Snapshot")
    .option("--result <result>", "результат внешней проверки", {
      choices: ["pass", "fail"],
      required: true,
    })
    .option("--source <source>", "источник результата", {
      choices: ["human", "agent", "ci"],
      required: true,
    })
    .option("--note <text>", "необязательная заметка", { parser: singleValue })
    .actionWithContext(async (context, changeId, options) => {
      const result = await serviceFactory(context).recordVerification({
        changeId,
        result: options.result,
        source: options.source,
        note: options.note,
        confirm: confirmReceipt,
      });
      if (result.status === "cancelled") {
        write("Отменено пользователем; Verification Receipt не записан.");
      } else {
        write(
          `Verification Receipt ${result.status === "created" ? "создан" : "заменён"}: ` +
            result.receipt.receipt_id,
        );
      }
    }, { scope: "store" });
}
