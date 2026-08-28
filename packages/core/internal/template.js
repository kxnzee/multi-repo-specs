/** @fileoverview Универсальный доменный движок Project Template. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import * as z from "zod";

import { AgentDefinition } from "./agent-definition.js";
import { CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { isContainedPath, isPortableRelativePath } from "./path.js";
import { deepFreeze } from "./value.js";

const ID_SCHEMA = z.string().regex(CORE_PATTERNS.id, "ожидается lowercase kebab-case");

/** Создаёт schema переносимого относительного пути. */
function relativePathSchema(allowDot) {
  return z.string().refine(
    (value) => isPortableRelativePath(value, { allowDot }),
    "должен быть безопасным относительным POSIX-путём",
  );
}

const RELATIVE_PATH_SCHEMA = relativePathSchema(true);
const COPY_SCHEMA = z.strictObject({
  from: RELATIVE_PATH_SCHEMA,
  to: RELATIVE_PATH_SCHEMA,
});
const TEMPLATE_SCHEMA = z.strictObject({
  id: ID_SCHEMA,
  name: z.string().trim().min(1),
  copy: z.array(COPY_SCHEMA).min(1),
});
const PROTECTED_ROOTS = new Set([
  ".git",
  ".openspec-store",
  CORE_FILES.orchestratorConfig,
]);

/** Разбирает и строго проверяет Template descriptor. */
function parseDescriptor(source, schema = TEMPLATE_SCHEMA) {
  let value;
  try {
    value = parse(source);
  } catch (error) {
    throw new Error(`Некорректный ${CORE_FILES.templateDescriptor}: ${error.message}`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Некорректный ${CORE_FILES.templateDescriptor}: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/** Канонизирует существующий обычный directory root. */
async function resolveDirectoryRoot(requestedRoot, label) {
  if (typeof requestedRoot !== "string" || requestedRoot.length === 0) {
    throw new Error(`${label} должен быть указан`);
  }
  const absolute = path.resolve(requestedRoot);
  const stat = await lstatOrNull(absolute);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} должен быть существующим обычным каталогом: ${absolute}`);
  }
  return fs.realpath(absolute);
}

/** Reads one validated descriptor after checking the complete Template source tree. */
async function readTemplateDescriptor(templateRoot, schema) {
  await listSourceFiles(templateRoot, "", "Template root");
  const descriptorStat = await inspectSourcePath(
    templateRoot,
    CORE_FILES.templateDescriptor,
    "Template descriptor",
  );
  if (!descriptorStat.isFile()) {
    throw new Error(`${CORE_FILES.templateDescriptor} должен быть обычным файлом`);
  }
  return parseDescriptor(
    await fs.readFile(path.join(templateRoot, CORE_FILES.templateDescriptor), "utf8"),
    schema,
  );
}

/** Разрешает проверенный POSIX path относительно root текущей платформы. */
function resolveRelative(root, relativePath) {
  return relativePath === "." ? root : path.join(root, ...relativePath.split("/"));
}

/** Проверяет source path и каждый его существующий компонент. */
async function inspectSourcePath(root, relativePath, label) {
  if (relativePath === ".") return fs.lstat(root);
  let current = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) throw new Error(`${label} не существует: ${relativePath}`);
    if (stat.isSymbolicLink()) throw new Error(`${label} содержит symlink: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} проходит через файл: ${relativePath}`);
    }
    if (index === segments.length - 1) return stat;
  }
  throw new Error(`${label} не удалось проверить`);
}

/** Рекурсивно перечисляет безопасные обычные Template files. */
async function listSourceFiles(root, relativeDirectory, label) {
  const absoluteDirectory = resolveRelative(root, relativeDirectory || ".");
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolute = path.join(absoluteDirectory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`${label} содержит symlink: ${relative}`);
    if (stat.isDirectory()) files.push(...await listSourceFiles(root, relative, label));
    else if (stat.isFile()) files.push({ absolute, relative, mode: stat.mode & 0o777 });
    else throw new Error(`${label} содержит специальный файловый объект: ${relative}`);
  }
  return files;
}

/** Запрещает Template писать в Core-owned project paths. */
function assertNotProtected(relativePath, label) {
  const [root] = relativePath.split("/");
  if (PROTECTED_ROOTS.has(root.toLowerCase())) {
    throw new Error(`${label} пытается использовать защищённый Core path: ${relativePath}`);
  }
}

/** Проверяет target components без принятия решения об overwrite. */
async function inspectTemplateTarget(targetRoot, relativePath) {
  let current = targetRoot;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new Error(`Target содержит symlink: ${relativePath}`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`Target содержит file-directory collision: ${relativePath}`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`Target конфликтует с каталогом или специальным объектом: ${relativePath}`);
    }
    if (final) return stat;
  }
  return null;
}

/** Проверяет отсутствие symlink в agent target path. */
async function assertNoTargetSymlink(targetRoot, relativePath) {
  let current = targetRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error(`Target содержит symlink: ${relativePath}`);
  }
}

/** Проверяет file-directory collisions итогового plan. */
function assertNoPlanCollisions(files) {
  const targets = new Map();
  for (const { targetRelative } of files) {
    const normalized = targetRelative.toLowerCase();
    const existing = targets.get(normalized);
    if (existing && existing !== targetRelative) {
      throw new Error(`Template создаёт регистронезависимую коллизию: ${existing} и ${targetRelative}`);
    }
    targets.set(normalized, targetRelative);
  }
  for (const target of targets.values()) {
    const segments = target.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      const existing = targets.get(parent.toLowerCase());
      if (existing) {
        throw new Error(`Template создаёт file-directory collision: ${existing} и ${target}`);
      }
    }
  }
}

/** Builds one safe file-overlay plan from Template-compatible copy operations. */
async function planCopyFiles(sourceRoot, targetRoot, copy, labelRoot, isDynamicallyProtected = () => false) {
  const files = [];
  for (const [operationIndex, operation] of copy.entries()) {
    assertNotProtected(operation.to, `${labelRoot}[${operationIndex}].to`);
    const label = `${labelRoot}[${operationIndex}].from`;
    const sourceStat = await inspectSourcePath(sourceRoot, operation.from, label);
    const sourceFiles = sourceStat.isFile()
      ? [{
          absolute: resolveRelative(sourceRoot, operation.from),
          relative: "",
          mode: sourceStat.mode & 0o777,
        }]
      : sourceStat.isDirectory()
        ? await listSourceFiles(
            sourceRoot,
            operation.from === "." ? "" : operation.from,
            label,
          )
        : null;
    if (!sourceFiles) throw new Error(`${label} должен быть обычным файлом или каталогом`);
    for (const sourceFile of sourceFiles) {
      const sourceRelative = sourceStat.isFile()
        ? ""
        : sourceFile.relative.slice(operation.from === "." ? 0 : operation.from.length + 1);
      const targetRelative = !sourceRelative
        ? operation.to
        : operation.to === "."
          ? sourceRelative
          : `${operation.to}/${sourceRelative}`;
      if (targetRelative === ".") {
        throw new Error(`${labelRoot}[${operationIndex}].to не может заменить target root`);
      }
      assertNotProtected(targetRelative, `${labelRoot}[${operationIndex}]`);
      if (isDynamicallyProtected(targetRelative)) {
        throw new Error(
          `${labelRoot}[${operationIndex}] пытается использовать защищённый Agent path: ${targetRelative}`,
        );
      }
      const canonicalSource = await fs.realpath(sourceFile.absolute);
      if (!isContainedPath(sourceRoot, canonicalSource, { allowRoot: true })) {
        throw new Error(`${label} выходит за source root`);
      }
      files.push({
        contents: await fs.readFile(canonicalSource),
        source: canonicalSource,
        target: resolveRelative(targetRoot, targetRelative),
        targetRelative,
        mode: sourceFile.mode,
        operationIndex,
      });
    }
  }
  assertNoPlanCollisions(files);
  for (const file of files) await inspectTemplateTarget(targetRoot, file.targetRelative);
  return files;
}

/** Проверенный Template plan с операциями preflight, adaptation и apply. */
export class TemplatePlan {
  #targetRoot;
  #agent;
  #files;
  #id;
  #name;

  constructor({ templateRoot, targetRoot, agent, files, id = null, name = null }) {
    if (typeof templateRoot !== "string" || templateRoot.length === 0) {
      throw new Error("TEMPLATE_PLAN_INVALID: templateRoot обязателен");
    }
    this.#targetRoot = targetRoot;
    this.#agent = agent;
    this.#files = Object.freeze(files.map((file) => Object.freeze({ ...file })));
    this.#id = id;
    this.#name = name;
    Object.freeze(this);
  }

  get agent() { return this.#agent; }
  get id() { return this.#id; }
  get name() { return this.#name; }

  /** Relative Store paths delivered by this plan. */
  get targetPaths() {
    return deepFreeze([...new Set(this.#files.map(({ targetRelative }) => targetRelative))].sort());
  }

  async inspectPreExistingFiles() {
    const finalFiles = new Map();
    for (const file of this.#files) finalFiles.set(file.targetRelative, file);
    const unchanged = new Set();
    for (const file of finalFiles.values()) {
      const stat = await lstatOrNull(file.target);
      if (!stat) continue;
      const [actual, expected] = await Promise.all([
        fs.readFile(file.target),
        Promise.resolve(file.contents),
      ]);
      if (!actual.equals(expected)) {
        throw new Error(
          `Инициализации мешает существующий файл с другим содержимым: ${file.targetRelative}`,
        );
      }
      unchanged.add(file.targetRelative);
    }
    return unchanged;
  }

  async assertAgentPackPathsAvailable() {
    for (const relativePath of new Set([
      this.#agent.generatedDirectory,
      this.#agent.targetDirectory,
    ])) {
      if (await lstatOrNull(path.join(this.#targetRoot, relativePath))) {
        throw new Error(`Инициализации мешает существующий agent pack: ${relativePath}/`);
      }
    }
  }

  async apply(unchangedPreExisting) {
    const created = new Set();
    const updated = new Set();
    for (const file of this.#files) {
      if (unchangedPreExisting.has(file.targetRelative)) continue;
      const targetStat = await inspectTemplateTarget(this.#targetRoot, file.targetRelative);
      await fs.mkdir(path.dirname(file.target), { recursive: true });
      await fs.writeFile(file.target, file.contents);
      await fs.chmod(file.target, file.mode);
      if (!created.has(file.targetRelative) && !updated.has(file.targetRelative)) {
        if (targetStat) updated.add(file.targetRelative);
        else created.add(file.targetRelative);
      }
    }
    return deepFreeze({ created: [...created].sort(), updated: [...updated].sort() });
  }

  /** Applies this plan idempotently after the same conflict preflight as Template init. */
  async install() {
    return this.apply(await this.inspectPreExistingFiles());
  }

  async cleanupGeneratedAgentPack() {
    for (const relativePath of new Set([
      this.#agent.generatedDirectory,
      this.#agent.targetDirectory,
    ])) {
      await fs.rm(path.join(this.#targetRoot, relativePath), { recursive: true, force: true });
    }
  }
}

/** Загружает отдельный Project Template и строит безопасный plan без записи. */
export class ProjectTemplateService {
  async plan({ templateRoot: requestedTemplateRoot, targetRoot: requestedTargetRoot, agent }) {
    const templateRoot = await resolveDirectoryRoot(requestedTemplateRoot, "Template root");
    const targetRoot = await resolveDirectoryRoot(requestedTargetRoot, "Target root");
    if (
      isContainedPath(templateRoot, targetRoot, { allowRoot: true }) ||
      isContainedPath(targetRoot, templateRoot, { allowRoot: true })
    ) {
      throw new Error("Template root и target root не должны пересекаться");
    }
    const descriptor = await readTemplateDescriptor(templateRoot, TEMPLATE_SCHEMA);
    if (!(agent instanceof AgentDefinition)) {
      throw new Error("TEMPLATE_AGENT_INVALID: требуется независимый AgentDefinition");
    }
    for (const [label, relativePath] of [
      [`agent.${agent.id}.generatedDirectory`, agent.generatedDirectory],
      [`agent.${agent.id}.targetDirectory`, agent.targetDirectory],
      [`agent.${agent.id}.commandsDirectory`, agent.commandsDirectory],
      [`agent.${agent.id}.instructionsFile`, agent.instructionsFile],
    ]) {
      assertNotProtected(relativePath, label);
      await assertNoTargetSymlink(targetRoot, relativePath);
    }
    const files = await planCopyFiles(
      templateRoot,
      targetRoot,
      descriptor.copy,
      "copy",
      (targetRelative) => agent.protects(targetRelative),
    );
    return new TemplatePlan({
      templateRoot,
      targetRoot,
      agent,
      files,
      id: descriptor.id,
      name: descriptor.name,
    });
  }

}

/** Общий Project Template Service нового Core. */
export const projectTemplates = Object.freeze(new ProjectTemplateService());
