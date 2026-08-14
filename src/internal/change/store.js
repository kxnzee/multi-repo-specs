/** @fileoverview Проверки Store и schema-neutral OpenSpec Change. */

import * as z from "zod";

import {
  resolveContainedDeclaredPath,
  resolveContainedExistingPath,
} from "../shared/files.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { isPortableRelativePath } from "../shared/paths.js";
import { openSpecContractError, parseOpenSpecContract } from "../shared/schema.js";
import { findSpecRoot, readStoreConfiguration, validateOpenSpec } from "../shared/store.js";

const NON_EMPTY_STRING = z.string().min(1);
const CREATED_CHANGE_SCHEMA = z.looseObject({
  id: NON_EMPTY_STRING,
  path: NON_EMPTY_STRING,
  schema: NON_EMPTY_STRING,
});
const ARTIFACT_SCHEMA = z.looseObject({
  id: NON_EMPTY_STRING,
  outputPath: NON_EMPTY_STRING,
  status: z.enum(["done", "skipped", "ready", "blocked"]),
});
const ARTIFACT_PATH_SCHEMA = z.looseObject({
  outputPath: NON_EMPTY_STRING,
  resolvedOutputPath: NON_EMPTY_STRING,
  existingOutputPaths: z.array(NON_EMPTY_STRING),
});
const STATUS_SCHEMA = z.looseObject({
  changeName: NON_EMPTY_STRING,
  schemaName: NON_EMPTY_STRING,
  changeRoot: NON_EMPTY_STRING,
  artifacts: z.array(ARTIFACT_SCHEMA),
  artifactPaths: z.record(NON_EMPTY_STRING, z.unknown()),
});

/** @param {unknown} value @param {string} label @returns {string} */
function assertRelativeArtifactPath(value, label) {
  if (!isPortableRelativePath(value, { allowDot: false })) {
    throw new Error(`${label} содержит некорректный относительный путь`);
  }
  return value;
}

/**
 * Разрешает и проверяет центральный Store перед изменением Git.
 *
 * @param {string} start
 * @param {typeof import("../shared/command.js").runCommand} commandRunner
 * @returns {Promise<{
 *   projectRoot: string,
 *   storeId: string,
 *   config: ReturnType<typeof import("../config/index.js").parseOrchestratorConfig>,
 *   activeChanges: Array<{name: string}>
 * }>}
 */
export async function resolveChangeStore(start, commandRunner) {
  const projectRoot = await findSpecRoot(start);
  const { metadata, config } = await readStoreConfiguration(projectRoot);
  const activeChanges = validateOpenSpec(
    projectRoot,
    metadata.id,
    commandRunner,
  );
  return { projectRoot, storeId: metadata.id, config, activeChanges };
}

/**
 * Проверяет JSON успешного `openspec new change` без предположений о schema и layout.
 *
 * @param {import("../shared/types.js").OpenSpecResponse} payload
 * @param {{projectRoot: string, storeId: string, changeId: string}} expected
 * @returns {Promise<{changeRoot: string, schema: string}>}
 */
export async function assertCreatedChange(payload, expected) {
  assertOpenSpecRoot(
    payload.root,
    { path: expected.projectRoot, storeId: expected.storeId, source: "store" },
    "openspec new change",
  );
  const change = parseOpenSpecContract(
    CREATED_CHANGE_SCHEMA,
    payload.change,
    "openspec new change --json",
  );
  if (change.id !== expected.changeId) {
    throw new Error(
      `Ответ \`openspec new change --json\` относится к Change ${change.id}, ожидался ${expected.changeId}`,
    );
  }
  const changeRoot = await resolveContainedExistingPath(
    expected.projectRoot,
    change.path,
    "OpenSpec Change path",
    "directory",
  );
  return { changeRoot, schema: change.schema };
}

/**
 * Получает и проверяет динамический статус Change.
 *
 * @param {string} projectRoot
 * @param {string} storeId
 * @param {string} changeId
 * @param {typeof import("../shared/command.js").runCommand} commandRunner
 * @param {{changeRoot?: string, schema?: string}} [expected]
 * @returns {Promise<{status: import("../shared/types.js").OpenSpecResponse, changeRoot: string, schema: string, nextArtifact: Record<string, unknown> | null}>}
 */
export async function readChangeStatus(
  projectRoot,
  storeId,
  changeId,
  commandRunner,
  expected = {},
) {
  const status = runOpenSpecJson(
    commandRunner,
    ["status", "--change", changeId, "--store", storeId, "--json"],
    projectRoot,
  );
  assertOpenSpecRoot(
    status.root,
    { path: projectRoot, storeId, source: "store" },
    "openspec status",
  );
  const changeStatus = parseOpenSpecContract(
    STATUS_SCHEMA,
    status,
    "openspec status --json",
  );
  if (changeStatus.changeName !== changeId) {
    throw new Error(
      `Ответ \`openspec status --json\` относится к Change ${changeStatus.changeName}, ожидался ${changeId}`,
    );
  }
  const changeRoot = await resolveContainedExistingPath(
    projectRoot,
    changeStatus.changeRoot,
    "OpenSpec status changeRoot",
    "directory",
  );
  if (expected.changeRoot !== undefined && changeRoot !== expected.changeRoot) {
    throw new Error(
      `OpenSpec Orchestrator ожидал Change root ${expected.changeRoot}, ` +
      `но \`openspec status --json\` указала ${changeRoot}`,
    );
  }
  if (expected.schema !== undefined && changeStatus.schemaName !== expected.schema) {
    throw new Error(
      `OpenSpec Orchestrator ожидал schema ${expected.schema}, ` +
      `но \`openspec status --json\` указала ${changeStatus.schemaName}`,
    );
  }

  const artifacts = [];
  const ids = new Set();
  for (const artifact of changeStatus.artifacts) {
    if (ids.has(artifact.id)) {
      throw openSpecContractError("openspec status --json", `повторяется artifact ${artifact.id}`);
    }
    ids.add(artifact.id);
    const outputPath = assertRelativeArtifactPath(
      artifact.outputPath,
      `OpenSpec artifact ${artifact.id}`,
    );
    const rawPathInfo = changeStatus.artifactPaths[artifact.id];
    if (!rawPathInfo) {
      throw openSpecContractError("openspec status --json", `отсутствуют пути artifact ${artifact.id}`);
    }
    const pathInfo = parseOpenSpecContract(
      ARTIFACT_PATH_SCHEMA,
      rawPathInfo,
      `openspec status --json (artifactPaths.${artifact.id})`,
    );
    if (pathInfo.outputPath !== outputPath) {
      throw openSpecContractError(
        "openspec status --json",
        `artifactPaths.${artifact.id}.outputPath не совпадает с artifact graph`,
      );
    }
    const resolvedOutputPath = await resolveContainedDeclaredPath(
      changeRoot,
      pathInfo.resolvedOutputPath,
      `OpenSpec artifact ${artifact.id} resolvedOutputPath`,
    );
    const existingOutputPaths = [];
    for (const existingPath of pathInfo.existingOutputPaths) {
      existingOutputPaths.push(await resolveContainedExistingPath(
        changeRoot,
        existingPath,
        `OpenSpec artifact ${artifact.id} existingOutputPath`,
        "file",
      ));
    }
    artifacts.push({
      ...artifact,
      outputPath,
      resolvedOutputPath,
      existingOutputPaths,
    });
  }
  const ready = artifacts.find((artifact) => artifact.status === "ready") ?? null;
  return {
    status: changeStatus,
    changeRoot,
    schema: changeStatus.schemaName,
    nextArtifact: ready,
  };
}
