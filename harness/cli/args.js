/** @fileoverview Разбор аргументов команд SDD CLI. */

import { supportedAgentIds } from "../config/agents.js";
import { validateChangeName } from "../change/index.js";
import { validateTicket } from "../explore/index.js";
import { parseRepository } from "../init/index.js";

export const HELP = `Использование:
  sdd init [path] --store <store-id> --agent <agent-id> [--repo <id=url#branch>]...
  sdd connect [--workspace <path>]
  sdd explore --ticket <ticket-id> [--workspace <path>]
  sdd change --ticket <ticket-id> --name <short-name>

Команды:
  init    Один раз создать OpenSpec Store и каркас центрального проекта
  connect Подключить рабочую машину и загрузить Code Repositories
  explore Проверить workspace и подготовить единый вызов /opsx-explore
  change  Создать или безопасно продолжить OpenSpec Change в planning-ветке

Параметры:
  --store <id>    Store ID и repository-id центрального репозитория
  --agent <id>    Agent adapter: ${supportedAgentIds().join(", ")}
  --repo <value>  Добавить известный репозиторий с кодом; параметр можно повторять
                  Пример: --repo ui=https://example.test/ui.git#main
  --workspace     Явно задать корень workspace для sdd connect или sdd explore
  --ticket <key>  Jira ticket key в формате PAY-412
  --name <value>  Короткое имя Change в lowercase kebab-case
  -h, --help      Показать эту справку
`;

/**
 * Разбирает аргументы `sdd init` и проверяет обязательные одиночные флаги.
 *
 * @param {string[]} args Аргументы после имени команды `init`.
 * @returns {{help: boolean, target: string, storeId: string | undefined, agentId: string | undefined, repositories: Array<{id: string, role: "code", url: string, defaultBranch: string}>}} Нормализованные параметры запуска.
 */
export function parseInitArgs(args) {
  let target = ".";
  let targetWasSet = false;
  let storeId;
  let agentId;
  const repositories = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      return { help: true, target, storeId, agentId, repositories };
    }
    if (arg === "--store" || arg.startsWith("--store=")) {
      const value = arg === "--store" ? args[index + 1] : arg.slice("--store=".length);
      if (!value) throw new Error("для --store требуется Store ID");
      if (storeId) throw new Error("--store можно указать только один раз");
      storeId = value;
      if (arg === "--store") index += 1;
      continue;
    }
    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const value = arg === "--agent" ? args[index + 1] : arg.slice("--agent=".length);
      if (!value) throw new Error("для --agent требуется agent ID");
      if (agentId) throw new Error("--agent можно указать только один раз");
      agentId = value;
      if (arg === "--agent") index += 1;
      continue;
    }
    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const value = arg === "--repo" ? args[index + 1] : arg.slice("--repo=".length);
      if (!value) throw new Error("для --repo требуется <id=url#branch>");
      repositories.push(parseRepository(value));
      if (arg === "--repo") index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Неизвестный параметр: ${arg}`);
    if (targetWasSet) throw new Error(`Неожиданный аргумент: ${arg}`);
    target = arg;
    targetWasSet = true;
  }

  if (!storeId) throw new Error("для sdd init требуется --store <store-id>");
  if (!agentId) throw new Error("для sdd init требуется --agent <agent-id>");
  return { help: false, target, storeId, agentId, repositories };
}

/**
 * Разбирает необязательный путь workspace для `sdd connect`.
 *
 * @param {string[]} args Аргументы после имени команды `connect`.
 * @returns {{help: boolean, workspace?: string}} Нормализованные параметры запуска.
 */
export function parseConnectArgs(args) {
  let workspace;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      const value = arg === "--workspace" ? args[index + 1] : arg.slice("--workspace=".length);
      if (!value) throw new Error("для --workspace требуется путь");
      if (workspace) throw new Error("--workspace можно указать только один раз");
      workspace = value;
      if (arg === "--workspace") index += 1;
      continue;
    }
    throw new Error(`Неизвестный параметр connect: ${arg}`);
  }
  return { help: false, workspace };
}

/**
 * Разбирает ticket и необязательный workspace для `sdd explore`.
 *
 * @param {string[]} args Аргументы после имени команды `explore`.
 * @returns {{help: boolean, ticket?: string, workspace?: string}} Нормализованные параметры запуска.
 */
export function parseExploreArgs(args) {
  let ticket;
  let workspace;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--ticket" || arg.startsWith("--ticket=")) {
      const value = arg === "--ticket" ? args[index + 1] : arg.slice("--ticket=".length);
      if (!value) throw new Error("для --ticket требуется Jira key");
      if (ticket) throw new Error("--ticket можно указать только один раз");
      ticket = validateTicket(value);
      if (arg === "--ticket") index += 1;
      continue;
    }
    if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      const value = arg === "--workspace" ? args[index + 1] : arg.slice("--workspace=".length);
      if (!value) throw new Error("для --workspace требуется путь");
      if (workspace) throw new Error("--workspace можно указать только один раз");
      workspace = value;
      if (arg === "--workspace") index += 1;
      continue;
    }
    throw new Error(`Неизвестный параметр explore: ${arg}`);
  }
  if (!ticket) throw new Error("для sdd explore требуется --ticket <ticket-id>");
  return { help: false, ticket, workspace };
}

/**
 * Разбирает ticket и короткое имя для `sdd change`.
 *
 * @param {string[]} args Аргументы после имени команды `change`.
 * @returns {{help: boolean, ticket?: string, name?: string}} Нормализованные параметры запуска.
 */
export function parseChangeArgs(args) {
  let ticket;
  let name;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--ticket" || arg.startsWith("--ticket=")) {
      const value = arg === "--ticket" ? args[index + 1] : arg.slice("--ticket=".length);
      if (!value) throw new Error("для --ticket требуется Jira key");
      if (ticket) throw new Error("--ticket можно указать только один раз");
      ticket = validateTicket(value);
      if (arg === "--ticket") index += 1;
      continue;
    }
    if (arg === "--name" || arg.startsWith("--name=")) {
      const value = arg === "--name" ? args[index + 1] : arg.slice("--name=".length);
      if (!value) throw new Error("для --name требуется короткое имя Change");
      if (name) throw new Error("--name можно указать только один раз");
      name = validateChangeName(value);
      if (arg === "--name") index += 1;
      continue;
    }
    throw new Error(`Неизвестный параметр change: ${arg}`);
  }
  if (!ticket) throw new Error("для sdd change требуется --ticket <ticket-id>");
  if (!name) throw new Error("для sdd change требуется --name <short-name>");
  return { help: false, ticket, name };
}
