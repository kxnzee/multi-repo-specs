/** @fileoverview Официальные OpenSpec-вызовы, необходимые только для `init`. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SERVICE_PATHS } from "../config/constants.js";
import { PROJECT_SETTINGS } from "../config/settings.js";
import { requireOpenSpecCapability } from "../shared/compatibility.js";
import { createOpenSpecClient } from "../shared/openspec-client.js";
import { assertOpenSpecStore, parseOpenSpecJson } from "../shared/openspec-model.js";
import { assertRepositoryId, isRecord } from "../shared/schema.js";

/**
 * Устанавливает официальный expanded agent pack без изменения профиля пользователя.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} agentAdapter Официальный OpenSpec adapter.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {Promise<void>}
 */
export async function installOpenSpec(projectRoot, agentAdapter, commandRunner) {
  const openSpec = createOpenSpecClient(projectRoot, commandRunner);
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-openspec-profile-"));
  const openSpecConfigRoot = path.join(configRoot, SERVICE_PATHS.openSpecDirectory);
  try {
    await fs.mkdir(openSpecConfigRoot, { recursive: true });
    await fs.writeFile(
      path.join(configRoot, SERVICE_PATHS.openSpecProfileConfig),
      `${JSON.stringify({
        profile: PROJECT_SETTINGS.openSpec.init.profile,
        delivery: PROJECT_SETTINGS.openSpec.init.delivery,
        workflows: PROJECT_SETTINGS.openSpec.init.workflows,
      }, null, 2)}\n`,
      "utf8",
    );
    await openSpec.execute(
      [
        "init",
        projectRoot,
        "--tools",
        agentAdapter,
        "--profile",
        PROJECT_SETTINGS.openSpec.init.profile,
        "--no-animation",
      ],
      { environment: { XDG_CONFIG_HOME: configRoot } },
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
 * @returns {Promise<void>}
 */
export async function assertStorePathAvailable(projectRoot, commandRunner) {
  const openSpec = createOpenSpecClient(projectRoot, commandRunner);
  const args = ["store", "list", "--json"];
  const registry = parseOpenSpecJson(
    await openSpec.execute(args),
    `openspec ${args.join(" ")}`,
  );
  requireOpenSpecCapability(
    Array.isArray(registry.stores),
    "openspec store list --json: stores[]",
  );
  const registrations = registry.stores.filter(
    (store) => isRecord(store) &&
      typeof store.root === "string" &&
      path.resolve(store.root) === projectRoot,
  );
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
 * @returns {Promise<void>}
 */
export async function setupStore(projectRoot, storeId, remote, commandRunner) {
  const openSpec = createOpenSpecClient(projectRoot, commandRunner);
  const args = [
    "store",
    "setup",
    storeId,
    "--path",
    projectRoot,
    "--no-init-git",
    "--remote",
    remote,
    "--json",
  ];
  const output = await openSpec.execute(args, { sensitiveValues: [remote] });
  const result = parseOpenSpecJson(output, `openspec store setup ${storeId}`);
  assertOpenSpecStore(result.store, { path: projectRoot, storeId }, "openspec store setup");
}
