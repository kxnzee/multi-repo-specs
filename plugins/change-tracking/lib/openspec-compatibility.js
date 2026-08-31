/** @fileoverview Canonical OpenSpec Apply task integration. */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/** Parses one OpenSpec JSON response. */
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

/** Requires the scoped process capability used by the integration. */
function requireProcess(process) {
  if (!process || typeof process.run !== "function") {
    throw new Error("OPENSPEC_11_REQUIRED: отсутствует scoped Process facade");
  }
  return process;
}

/** Requires the verified OpenSpec API range. */
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

/** Reads schema-independent task progress from the canonical OpenSpec Apply API. */
export async function applyInstructions(process, changeId) {
  const args = ["instructions", "apply", "--change", changeId, "--json"];
  const command = `openspec ${args.join(" ")}`;
  const value = parseJson(await requireProcess(process).run("openspec", args), command);
  if (
    value.changeName !== changeId ||
    typeof value.schemaName !== "string" || value.schemaName.length === 0 ||
    !Array.isArray(value.tasks)
  ) {
    throw new Error(`OPENSPEC_STATUS_INVALID: ${command} не содержит Apply task progress`);
  }
  const ids = new Set();
  const tasks = value.tasks.map((task) => {
    if (
      !task || typeof task !== "object" || Array.isArray(task) ||
      typeof task.id !== "string" || task.id.length === 0 || ids.has(task.id) ||
      typeof task.description !== "string" || task.description.length === 0 ||
      typeof task.done !== "boolean"
    ) {
      throw new Error(`OPENSPEC_STATUS_INVALID: ${command} содержит некорректный task`);
    }
    ids.add(task.id);
    return Object.freeze({ id: task.id, description: task.description, done: task.done });
  });
  return Object.freeze({
    changeName: value.changeName,
    schemaName: value.schemaName,
    tasks: Object.freeze(tasks),
  });
}
