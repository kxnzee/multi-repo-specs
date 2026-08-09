/** @fileoverview Разбор аргументов команд SDD CLI. */

import { supportedAgentIds } from "../config/agents.js";
import { assertRepositoryId } from "../config/index.js";
import { validateChangeName } from "../change/index.js";
import { validateTicket } from "../explore/index.js";
import { parseRepository } from "../init/index.js";
import { isGitRevision } from "../shared/schema.js";

export const HELP = `Использование:
  sdd init [path] --store <store-id> --agent <agent-id> [--repo <id=url#branch>]...
  sdd connect [--workspace <path>]
  sdd explore --ticket <ticket-id> [--workspace <path>]
  sdd change --ticket <ticket-id> --name <short-name>
  sdd load --store <store-id> --repo <repository-id> --change <change-id> --baseline <40-char-sha> --work-package <id>... [--json]

Команды:
  init    Один раз создать OpenSpec Store и каркас центрального проекта
  connect Подключить рабочую машину и загрузить Code Repositories
  explore Проверить workspace и подготовить единый вызов /opsx-explore
  change  Создать или безопасно продолжить OpenSpec Change в planning-ветке
  load    Подготовить Code Repository к реализации на принятом Spec Baseline

Параметры:
  --store <id>    Store ID для sdd init или sdd load
  --agent <id>    Agent adapter: ${supportedAgentIds().join(", ")}
  --repo <value>  Для init: добавить id=url#branch; для load: указать repository-id
                  Пример init: --repo ui=https://example.test/ui.git#main
  --workspace     Явно задать корень workspace для sdd connect или sdd explore
  --ticket <key>  Jira ticket key в формате PAY-412
  --name <value>  Короткое имя Change в lowercase kebab-case
  --change <id>   Полный ID принятого OpenSpec Change
  --baseline <sha> Полная 40-символьная SHA принятого Store
  --work-package <id> Назначенный task.id из OpenSpec; параметр можно повторять
  --json          Вернуть результат sdd load в JSON
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

/**
 * Разбирает параметры подготовки реализации.
 *
 * @param {string[]} args Аргументы после имени команды `load`.
 * @returns {{help: boolean, storeId?: string, repositoryId?: string, change?: string, baseline?: string, workPackages?: string[], json?: boolean}}
 */
export function parseLoadArgs(args) {
  let storeId;
  let repositoryId;
  let change;
  let baseline;
  let json = false;
  const workPackages = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--json") {
      if (json) throw new Error("--json можно указать только один раз");
      json = true;
      continue;
    }
    if (arg === "--store" || arg.startsWith("--store=")) {
      const value = arg === "--store" ? args[index + 1] : arg.slice("--store=".length);
      if (!value || (arg === "--store" && value.startsWith("--"))) {
        throw new Error("для --store требуется Store ID");
      }
      if (storeId) throw new Error("--store можно указать только один раз");
      storeId = assertRepositoryId(value, "Store ID");
      if (arg === "--store") index += 1;
      continue;
    }
    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const value = arg === "--repo" ? args[index + 1] : arg.slice("--repo=".length);
      if (!value || (arg === "--repo" && value.startsWith("--"))) {
        throw new Error("для --repo требуется repository-id");
      }
      if (repositoryId) throw new Error("--repo можно указать только один раз");
      repositoryId = assertRepositoryId(value);
      if (arg === "--repo") index += 1;
      continue;
    }
    if (arg === "--change" || arg.startsWith("--change=")) {
      const value = arg === "--change" ? args[index + 1] : arg.slice("--change=".length);
      if (!value || (arg === "--change" && value.startsWith("--"))) {
        throw new Error("для --change требуется Change ID");
      }
      if (change) throw new Error("--change можно указать только один раз");
      change = validateChangeName(value);
      if (arg === "--change") index += 1;
      continue;
    }
    if (arg === "--baseline" || arg.startsWith("--baseline=")) {
      const value = arg === "--baseline" ? args[index + 1] : arg.slice("--baseline=".length);
      if (!value || (arg === "--baseline" && value.startsWith("--"))) {
        throw new Error("для --baseline требуется полная Git SHA");
      }
      if (baseline) throw new Error("--baseline можно указать только один раз");
      if (!isGitRevision(value)) throw new Error("--baseline должен быть полной lowercase 40-символьной SHA");
      baseline = value;
      if (arg === "--baseline") index += 1;
      continue;
    }
    if (arg === "--work-package" || arg.startsWith("--work-package=")) {
      const value = arg === "--work-package" ? args[index + 1] : arg.slice("--work-package=".length);
      if (!value || (arg === "--work-package" && value.startsWith("--"))) {
        throw new Error("для --work-package требуется task.id из OpenSpec");
      }
      if (workPackages.includes(value)) throw new Error(`Work Package ${value} передан дважды`);
      workPackages.push(value);
      if (arg === "--work-package") index += 1;
      continue;
    }
    throw new Error(`Неизвестный параметр load: ${arg}`);
  }
  if (!storeId) throw new Error("для sdd load требуется --store <store-id>");
  if (!repositoryId) throw new Error("для sdd load требуется --repo <repository-id>");
  if (!change) throw new Error("для sdd load требуется --change <change-id>");
  if (!baseline) throw new Error("для sdd load требуется --baseline <40-char-sha>");
  if (workPackages.length === 0) {
    throw new Error("для sdd load требуется хотя бы один --work-package <id>");
  }
  return { help: false, storeId, repositoryId, change, baseline, workPackages, json };
}
