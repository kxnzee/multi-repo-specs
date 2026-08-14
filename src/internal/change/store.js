/** @fileoverview Проверки Store и schema-neutral OpenSpec Change. */

import * as z from "zod";

import {
  resolveContainedDeclaredPath,
  resolveContainedExistingPath,
} from "../shared/files.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { isPortableRelativePath } from "../shared/paths.js";
import { findSpecRoot, readStoreConfiguration, validateOpenSpec } from "../shared/store.js";

const NON_EMPTY_STRING = z.string().min(1);
const STRING_LIST = z.array(NON_EMPTY_STRING);
const CREATED_CHANGE_SCHEMA = z.looseObject({
  id: NON_EMPTY_STRING,
  path: NON_EMPTY_STRING,
  metadataPath: NON_EMPTY_STRING,
  schema: NON_EMPTY_STRING,
});
const STATUS_SCHEMA = z.looseObject({
  changeName: NON_EMPTY_STRING,
  schemaName: NON_EMPTY_STRING,
  changeRoot: NON_EMPTY_STRING,
  isComplete: z.boolean(),
  applyRequires: STRING_LIST,
  artifacts: z.array(z.unknown()),
  artifactPaths: z.record(z.string(), z.unknown()),
});
const ARTIFACT_SCHEMA = z.looseObject({
  id: NON_EMPTY_STRING,
  outputPath: NON_EMPTY_STRING,
  status: z.enum(["done", "skipped", "ready", "blocked"]),
  requires: STRING_LIST,
  missingDeps: STRING_LIST.optional(),
});
const ARTIFACT_PATH_SCHEMA = z.looseObject({
  outputPath: NON_EMPTY_STRING,
  resolvedOutputPath: NON_EMPTY_STRING,
  existingOutputPaths: z.array(NON_EMPTY_STRING),
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
 * @returns {Promise<{changeRoot: string, metadataPath: string, schema: string}>}
 */
export async function assertCreatedChange(payload, expected) {
  assertOpenSpecRoot(
    payload.root,
    { path: expected.projectRoot, storeId: expected.storeId, source: "store" },
    "openspec new change",
  );
  const parsedChange = CREATED_CHANGE_SCHEMA.safeParse(payload.change);
  if (!parsedChange.success || parsedChange.data.id !== expected.changeId) {
    throw new Error("openspec new change вернула другой Change или некорректную schema");
  }
  const change = parsedChange.data;
  const changeRoot = await resolveContainedExistingPath(
    expected.projectRoot,
    change.path,
    "OpenSpec Change path",
    "directory",
  );
  const metadataPath = await resolveContainedExistingPath(
    changeRoot,
    change.metadataPath,
    "OpenSpec Change metadataPath",
    "file",
  );
  return { changeRoot, metadataPath, schema: change.schema };
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
  const parsedStatus = STATUS_SCHEMA.safeParse(status);
  if (!parsedStatus.success || parsedStatus.data.changeName !== changeId) {
    throw new Error("openspec status вернула некорректную identity или artifact graph Change");
  }
  const changeStatus = parsedStatus.data;
  const changeRoot = await resolveContainedExistingPath(
    projectRoot,
    changeStatus.changeRoot,
    "OpenSpec status changeRoot",
    "directory",
  );
  if (expected.changeRoot !== undefined && changeRoot !== expected.changeRoot) {
    throw new Error("openspec status вернула другой Change root");
  }
  if (expected.schema !== undefined && changeStatus.schemaName !== expected.schema) {
    throw new Error("openspec status вернула другую schema");
  }

  const artifacts = [];
  const ids = new Set();
  for (const rawArtifact of changeStatus.artifacts) {
    const parsedArtifact = ARTIFACT_SCHEMA.safeParse(rawArtifact);
    if (!parsedArtifact.success || ids.has(parsedArtifact.data.id)) {
      throw new Error("openspec status вернула некорректный artifact graph");
    }
    const artifact = parsedArtifact.data;
    ids.add(artifact.id);
    const outputPath = assertRelativeArtifactPath(
      artifact.outputPath,
      `OpenSpec artifact ${artifact.id}`,
    );
    const parsedPathInfo = ARTIFACT_PATH_SCHEMA.safeParse(changeStatus.artifactPaths[artifact.id]);
    if (!parsedPathInfo.success || parsedPathInfo.data.outputPath !== outputPath) {
      throw new Error(`openspec status не вернула пути artifact ${artifact.id}`);
    }
    const pathInfo = parsedPathInfo.data;
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
  const pathIds = Object.keys(changeStatus.artifactPaths);
  if (pathIds.length !== ids.size || pathIds.some((id) => !ids.has(id))) {
    throw new Error("openspec status вернула пути вне artifact graph");
  }
  for (const artifact of artifacts) {
    if (
      artifact.requires.some((id) => !ids.has(id)) ||
      (artifact.missingDeps ?? []).some((id) => !ids.has(id))
    ) {
      throw new Error(`OpenSpec artifact ${artifact.id} ссылается на неизвестную зависимость`);
    }
  }

  const ready = artifacts.find((artifact) => artifact.status === "ready") ?? null;
  return {
    status: changeStatus,
    changeRoot,
    schema: changeStatus.schemaName,
    nextArtifact: ready,
  };
}
