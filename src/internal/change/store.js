/** @fileoverview Проверки Store и schema-neutral OpenSpec Change. */

import path from "node:path";

import {
  resolveContainedDeclaredPath,
  resolveContainedExistingPath,
} from "../shared/files.js";
import { assertOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
import { isRecord } from "../shared/schema.js";
import { findSpecRoot, readStoreConfiguration, validateOpenSpec } from "../shared/store.js";

const ARTIFACT_STATUSES = new Set(["done", "skipped", "ready", "blocked"]);

/** @param {unknown} value @param {string} label @returns {string} */
function assertRelativeArtifactPath(value, label) {
  if (
    typeof value !== "string" || !value || path.isAbsolute(value) ||
    value.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")
  ) {
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
  const change = payload.change;
  if (
    !isRecord(change) || change.id !== expected.changeId ||
    typeof change.schema !== "string" || !change.schema
  ) {
    throw new Error("openspec new change вернула другой Change или некорректную schema");
  }
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
  if (
    status.changeName !== changeId || typeof status.schemaName !== "string" || !status.schemaName ||
    typeof status.isComplete !== "boolean" || !Array.isArray(status.applyRequires) ||
    status.applyRequires.some((item) => typeof item !== "string" || !item) ||
    !Array.isArray(status.artifacts) || !isRecord(status.artifactPaths)
  ) {
    throw new Error("openspec status вернула некорректную identity или artifact graph Change");
  }
  const changeRoot = await resolveContainedExistingPath(
    projectRoot,
    status.changeRoot,
    "OpenSpec status changeRoot",
    "directory",
  );
  if (expected.changeRoot !== undefined && changeRoot !== expected.changeRoot) {
    throw new Error("openspec status вернула другой Change root");
  }
  if (expected.schema !== undefined && status.schemaName !== expected.schema) {
    throw new Error("openspec status вернула другую schema");
  }

  const artifacts = [];
  const ids = new Set();
  for (const artifact of status.artifacts) {
    if (
      !isRecord(artifact) || typeof artifact.id !== "string" || !artifact.id || ids.has(artifact.id) ||
      !ARTIFACT_STATUSES.has(artifact.status) || !Array.isArray(artifact.requires) ||
      artifact.requires.some((item) => typeof item !== "string" || !item) ||
      (artifact.missingDeps !== undefined &&
        (!Array.isArray(artifact.missingDeps) ||
          artifact.missingDeps.some((item) => typeof item !== "string" || !item)))
    ) {
      throw new Error("openspec status вернула некорректный artifact graph");
    }
    ids.add(artifact.id);
    const outputPath = assertRelativeArtifactPath(
      artifact.outputPath,
      `OpenSpec artifact ${artifact.id}`,
    );
    const pathInfo = status.artifactPaths[artifact.id];
    if (
      !isRecord(pathInfo) || pathInfo.outputPath !== outputPath ||
      !Array.isArray(pathInfo.existingOutputPaths)
    ) {
      throw new Error(`openspec status не вернула пути artifact ${artifact.id}`);
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
  const pathIds = Object.keys(status.artifactPaths);
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
    status,
    changeRoot,
    schema: status.schemaName,
    nextArtifact: ready,
  };
}
