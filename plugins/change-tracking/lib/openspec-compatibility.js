/** @fileoverview Plugin-owned OpenSpec 1.11 status integration. */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;
const ARTIFACT_STATUSES = Object.freeze(["done", "skipped", "ready", "blocked"]);

/** Parses one OpenSpec JSON response without leaking CLI details into callers. */
function parseJson(source, command) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} вернула некорректный JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} вернула несовместимый JSON`);
  }
  return value;
}

/** Requires the exact scoped process capability used by this integration. */
function requireProcess(process) {
  if (!process || typeof process.run !== "function") {
    throw new Error("OPENSPEC_11_REQUIRED: отсутствует scoped Process facade");
  }
  return process;
}

/** Requires OpenSpec 1.11 without accepting an unknown major version. */
export async function requireOpenSpec11(process) {
  const version = (await requireProcess(process).run("openspec", ["--version"])).trim();
  const match = VERSION.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (!match || major !== 1 || minor < 11) {
    throw new Error(
      `OPENSPEC_11_REQUIRED: Change Tracking требует OpenSpec >=1.11.0 <2; получена ${version}`,
    );
  }
  return version;
}

/** Reads and interprets the Plugin-owned Apply gate for one Change. */
export async function isChangeApplyReady(process, changeId) {
  const args = ["status", "--change", changeId, "--json"];
  const command = `openspec ${args.join(" ")}`;
  const value = parseJson(await requireProcess(process).run("openspec", args), command);
  if (
    value.changeName !== changeId ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.applyRequires)
  ) {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} не содержит artifact graph Change`);
  }
  const artifacts = new Map();
  for (const artifact of value.artifacts) {
    if (
      !artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
      typeof artifact.id !== "string" || artifacts.has(artifact.id) ||
      !ARTIFACT_STATUSES.includes(artifact.status) ||
      !Array.isArray(artifact.requires) ||
      artifact.requires.some((dependency) => typeof dependency !== "string")
    ) {
      throw new Error(`OPENSPEC_STATUS_INVALID: ${command} содержит некорректный artifact graph`);
    }
    artifacts.set(artifact.id, artifact);
  }
  const required = [...value.applyRequires];
  const visited = new Set();
  let ready = true;
  while (required.length > 0) {
    const artifactId = required.pop();
    if (typeof artifactId !== "string") {
      throw new Error(`OPENSPEC_STATUS_INVALID: ${command} содержит некорректный applyRequires`);
    }
    if (visited.has(artifactId)) continue;
    visited.add(artifactId);
    const artifact = artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`OPENSPEC_STATUS_INVALID: неизвестный artifact '${artifactId}'`);
    }
    if (!["done", "skipped"].includes(artifact.status)) ready = false;
    required.push(...artifact.requires);
  }
  return ready;
}

/** Lists active Change identities through the OpenSpec 1.11 batch contract. */
export async function activeChangeIds(process) {
  const args = ["status", "--all", "--json"];
  const command = `openspec ${args.join(" ")}`;
  const value = parseJson(await requireProcess(process).run("openspec", args, {
    acceptedExitCodes: [0, 1],
  }), command);
  if (
    !Array.isArray(value.changes) ||
    value.changes.some((change) => (
      !change || typeof change !== "object" || Array.isArray(change) ||
      typeof change.changeName !== "string" || change.changeName.length === 0
    ))
  ) {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} не содержит changes[]`);
  }
  return Object.freeze(value.changes.map(({ changeName }) => changeName));
}
