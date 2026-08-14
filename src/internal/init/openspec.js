/** @fileoverview Официальные OpenSpec-вызовы, необходимые только для `init`. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertRepositoryId } from "../config/index.js";
import { requireOpenSpecCapability } from "../shared/compatibility.js";
import { parseOpenSpecJson } from "../shared/openspec.js";

const EXPANDED_WORKFLOWS = Object.freeze([
  "propose",
  "explore",
  "new",
  "continue",
  "apply",
  "update",
  "ff",
  "sync",
  "archive",
  "bulk-archive",
  "verify",
  "onboard",
]);

/**
 * Устанавливает официальный expanded agent pack без изменения профиля пользователя.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} agentAdapter Официальный OpenSpec adapter.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {Promise<void>}
 */
export async function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-openspec-profile-"));
  const openSpecConfigRoot = path.join(configRoot, "openspec");
  try {
    await fs.mkdir(openSpecConfigRoot, { recursive: true });
    await fs.writeFile(
      path.join(openSpecConfigRoot, "config.json"),
      `${JSON.stringify({
        profile: "custom",
        delivery: "both",
        workflows: EXPANDED_WORKFLOWS,
      }, null, 2)}\n`,
      "utf8",
    );
    commandRunner(
      "openspec",
      ["init", projectRoot, "--tools", agentAdapter, "--profile", "custom", "--no-animation"],
      { cwd: projectRoot, environment: { XDG_CONFIG_HOME: configRoot } },
    );
  } finally {
    await fs.rm(configRoot, { recursive: true, force: true });
  }
}

/**
 * Блокирует init, если путь уже зарегистрирован как Store.
 *
 * @param {string} projectRoot Корень Store.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {void}
 */
export function assertStorePathAvailable(projectRoot, commandRunner) {
  const registry = parseOpenSpecJson(
    commandRunner("openspec", ["store", "list", "--json"], { cwd: projectRoot }),
    "openspec store list --json",
  );
  requireOpenSpecCapability(
    Array.isArray(registry.stores),
    "openspec store list --json: stores[]",
  );
  const registrations = Array.isArray(registry.stores)
    ? registry.stores.filter(({ root }) => path.resolve(root ?? "") === projectRoot)
    : [];
  if (registrations.length === 0) return;
  const registeredIds = registrations.map(({ id }) => {
    assertRepositoryId(id, "Store ID в локальном registry OpenSpec");
    return id;
  });
  const commands = registeredIds
    .map((registeredId) => `openspec store unregister ${registeredId}`)
    .join("\n");
  throw new Error(
    `Локальный registry OpenSpec уже регистрирует путь ${projectRoot} как Store: ` +
      `${registeredIds.join(", ")}. Для чистого первого запуска выполните:\n${commands}\n` +
      "Команда unregister удаляет только локальную регистрацию и не удаляет файлы. " +
      "После этого повторите openspec-orch init",
  );
}

/**
 * Создаёт Store официальной командой OpenSpec и проверяет identity.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} storeId Store ID.
 * @param {string} remote Git URL Store.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {void}
 */
export function setupStore(projectRoot, storeId, remote, commandRunner) {
  const output = commandRunner(
    "openspec",
    [
      "store",
      "setup",
      storeId,
      "--path",
      projectRoot,
      "--no-init-git",
      "--remote",
      remote,
      "--json",
    ],
    { cwd: projectRoot, sensitiveValues: [remote] },
  );
  const result = parseOpenSpecJson(output, `openspec store setup ${storeId}`);
  if (result.store?.id !== storeId || path.resolve(result.store?.root ?? "") !== projectRoot) {
    throw new Error("openspec store setup вернула другой Store");
  }
}
