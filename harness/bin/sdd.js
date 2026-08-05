#!/usr/bin/env node

import process from "node:process";
import { initProject, parseRepository } from "../init/index.js";

const HELP = `Использование:
  sdd init [path] [--force] [--repo <id=url#branch>]...

Команды:
  init    Создать или обновить управляемый каркас SDD + OpenSpec

Параметры:
  --force         Перезаписать все файлы, управляемые каркасом
  --repo <value>  Добавить известный репозиторий с кодом; параметр можно повторять
                  Пример: --repo ui=https://example.test/ui.git#main
  -h, --help      Показать эту справку
`;

function parseInitArgs(args) {
  let target = ".";
  let targetWasSet = false;
  let force = false;
  const repositories = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      return { help: true, target, force, repositories };
    }

    if (arg === "--force") {
      force = true;
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

  return { help: false, target, force, repositories };
}

function printPaths(title, paths) {
  console.log(`${title} (${paths.length})`);
  for (const filePath of paths) {
    console.log(`  ${filePath}`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
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
    force: options.force,
    repositories: options.repositories,
  });

  console.log(`Каркас SDD: ${result.target}`);
  console.log(`Корень OpenSpec: ${result.openSpecInitialized ? "создан" : "сохранён"}`);
  printPaths("Создано", result.created);
  printPaths("Перезаписано", result.overwritten);
  printPaths("Существующие файлы сохранены", result.skipped);
  console.log("Далее: запустите /sdd-context в Qwen Code");
}

main().catch((error) => {
  console.error(`sdd: ${error.message}`);
  process.exitCode = 1;
});
