#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { connectProject } from "../connect/index.js";
import { buildExploreInvocation, prepareExplore, validateTicket } from "../explore/index.js";
import { initProject, parseRepository } from "../init/index.js";

const HELP = `Использование:
  sdd init [path] --store <store-id> [--repo <id=url#branch>]...
  sdd connect [--workspace <path>]
  sdd explore --ticket <ticket-id>

Команды:
  init    Один раз создать OpenSpec Store и каркас центрального проекта
  connect Подключить рабочую машину и загрузить Code Repositories
  explore Подготовить read-only workspace и перейти к /opsx-explore

Параметры:
  --store <id>    Store ID и repository-id центрального репозитория
  --repo <value>  Добавить известный репозиторий с кодом; параметр можно повторять
                  Пример: --repo ui=https://example.test/ui.git#main
  --workspace     Явно задать корень workspace для sdd connect
  --ticket <key>  Jira ticket key в формате PAY-412
  -h, --help      Показать эту справку
`;

function parseInitArgs(args) {
  let target = ".";
  let targetWasSet = false;
  let storeId;
  const repositories = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      return { help: true, target, storeId, repositories };
    }

    if (arg === "--store") {
      const value = args[index + 1];
      if (!value) throw new Error("для --store требуется Store ID");
      if (storeId) throw new Error("--store можно указать только один раз");
      storeId = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--store=")) {
      if (storeId) throw new Error("--store можно указать только один раз");
      storeId = arg.slice("--store=".length);
      continue;
    }

    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("для --repo требуется <id=url#branch>");
      }
      repositories.push(parseRepository(value));
      index += 1;
      continue;
    }

    if (arg.startsWith("--repo=")) {
      repositories.push(parseRepository(arg.slice("--repo=".length)));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Неизвестный параметр: ${arg}`);
    }

    if (targetWasSet) {
      throw new Error(`Неожиданный аргумент: ${arg}`);
    }

    target = arg;
    targetWasSet = true;
  }

  if (!storeId) throw new Error("для sdd init требуется --store <store-id>");
  return { help: false, target, storeId, repositories };
}

function parseConnectArgs(args) {
  let workspace;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--workspace") {
      const value = args[index + 1];
      if (!value) throw new Error("для --workspace требуется путь");
      if (workspace) throw new Error("--workspace можно указать только один раз");
      workspace = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      if (workspace) throw new Error("--workspace можно указать только один раз");
      workspace = arg.slice("--workspace=".length);
      continue;
    }
    throw new Error(`Неизвестный параметр connect: ${arg}`);
  }
  return { help: false, workspace };
}

function parseExploreArgs(args) {
  let ticket;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") return { help: true };

    if (arg === "--ticket") {
      const value = args[index + 1];
      if (!value) throw new Error("для --ticket требуется Jira key");
      if (ticket) throw new Error("--ticket можно указать только один раз");
      ticket = validateTicket(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--ticket=")) {
      if (ticket) throw new Error("--ticket можно указать только один раз");
      ticket = validateTicket(arg.slice("--ticket=".length));
      continue;
    }

    throw new Error(`Неизвестный параметр explore: ${arg}`);
  }

  if (!ticket) throw new Error("для sdd explore требуется --ticket <ticket-id>");
  return { help: false, ticket };
}

function printPaths(title, paths) {
  console.log(`${title} (${paths.length})`);
  for (const filePath of paths) {
    console.log(`  ${filePath}`);
  }
}

async function confirm(prompt, question) {
  while (true) {
    const answer = (await prompt.question(`${question} [y/N] `)).trim().toLowerCase();
    if (["y", "yes", "д", "да"].includes(answer)) return true;
    if (["", "n", "no", "н", "нет"].includes(answer)) return false;
    console.log("Введите yes/да или no/нет.");
  }
}

function parseRepositoryNumbers(answer, repositories) {
  if (!answer.trim()) return [];
  const tokens = answer.trim().split(/[\s,]+/);
  const indexes = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) throw new Error(`Некорректный номер: ${token}`);
    const index = Number(token) - 1;
    if (index < 0 || index >= repositories.length) {
      throw new Error(`Репозитория с номером ${token} нет в checklist`);
    }
    if (seen.has(index)) throw new Error(`Репозиторий с номером ${token} выбран повторно`);
    seen.add(index);
    indexes.push(index);
  }

  return indexes.map((index) => repositories[index].id);
}

async function selectRepositories(prompt, repositories) {
  console.log("Code Repositories для Explore:");
  if (repositories.length === 0) console.log("  Зарегистрированных Code Repositories нет.");
  for (const [index, repository] of repositories.entries()) {
    console.log(`  [ ] ${index + 1}. ${repository.id} (${repository.defaultBranch})`);
  }

  while (true) {
    const answer = await prompt.question(
      "Введите номера через запятую; Enter — Explore только по Spec Root: ",
    );
    let selected;
    try {
      selected = parseRepositoryNumbers(answer, repositories);
    } catch (error) {
      console.log(error.message);
      continue;
    }

    const description =
      selected.length === 0 ? "только Spec Root" : selected.join(", ");
    if (await confirm(prompt, `Подтвердить область Explore: ${description}?`)) return selected;
  }
}

function printExploreResult(result) {
  console.log(`Explore подготовлен: ${result.ticket}`);
  console.log(`Spec Root: ${result.projectRoot}`);
  console.log(`Workspace: ${result.workspace}`);
  if (result.projectSpecsOnly) {
    console.log(`Code Repositories: нет, Explore только по ${result.storeRepositoryId}`);
  } else {
    console.log(`Code Repositories (${result.repositories.length}):`);
    for (const repository of result.repositories) {
      console.log(`  ${repository.id}`);
      console.log(`    branch: ${repository.branch}`);
      console.log(`    revision: ${repository.revision}`);
      console.log(`    path: ${repository.path}`);
    }
  }
  console.log("Команда для Qwen Code — скопируйте строку целиком:");
  console.log(buildExploreInvocation(result));
}

async function runExplore(args) {
  const options = parseExploreArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (process.stdin.isTTY !== true) {
    throw new Error("sdd explore требует интерактивный TTY для выбора репозиториев");
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await prepareExplore({
      ticket: options.ticket,
      selectRepositories: (repositories) => selectRepositories(prompt, repositories),
      confirmArchivedChange: async (changes) => {
        console.log(`Найдены архивные Changes с ticket ${options.ticket}:`);
        for (const change of changes) console.log(`  ${change}`);
        return confirm(prompt, "Продолжить новый Explore для этого ticket?");
      },
    });
    printExploreResult(result);
  } finally {
    prompt.close();
  }
}

async function runConnect(args) {
  const options = parseConnectArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  const result = await connectProject({ workspace: options.workspace });
  console.log(`Store: ${result.storeId} (${result.storeRoot})`);
  console.log(`Workspace: ${result.workspace}`);
  console.log("Локальная регистрация Store проверена OpenSpec.");
  for (const repository of result.repositories) {
    console.log(
      `${repository.id}: ${repository.status}${repository.cloned ? ", cloned" : ", existing"}`,
    );
    console.log(`  ${repository.path}`);
    if (repository.pointerCreated) {
      console.log("  создан openspec/config.yaml; требуется setup PR");
    }
  }
  console.log(`connect_status: ${result.status}`);
  if (result.status === "ready") console.log("Локальное подключение готово.");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }

  if (command === "explore") {
    await runExplore(args);
    return;
  }

  if (command === "connect") {
    await runConnect(args);
    return;
  }

  if (command !== "init") {
    throw new Error(`Неизвестная команда: ${command}\n\n${HELP}`);
  }

  const options = parseInitArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }

  const result = await initProject({
    target: options.target,
    storeId: options.storeId,
    repositories: options.repositories,
  });

  if (result.alreadyInitialized) {
    console.log(`Store ${result.storeId} уже инициализирован; файлы не изменены.`);
    console.log("Далее: выполните sdd connect");
    return;
  }
  console.log(`Store ${result.storeId}: ${result.target}`);
  printPaths("Создано", result.created);
  console.log("Далее: выполните sdd connect");
}

main().catch((error) => {
  console.error(`sdd: ${error.message}`);
  process.exitCode = 1;
});
