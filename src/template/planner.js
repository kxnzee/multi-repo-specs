/** @fileoverview Безопасный расчёт Project Template copy plan без записи файлов. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseTemplateDescriptor } from "./descriptor.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const BASE_TEMPLATE_ROOT = path.join(
  path.dirname(path.dirname(MODULE_ROOT)),
  "templates",
  "base",
);
const PROTECTED_ROOTS = new Set([".git", ".openspec-store", "openspec-orch.yaml"]);

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние пути либо `null`.
 */
async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Проверяет существующий корневой каталог без symlink.
 *
 * @param {string} requestedRoot Запрошенный путь.
 * @param {string} label Название root.
 * @returns {Promise<string>} Канонический путь.
 */
async function resolveDirectoryRoot(requestedRoot, label) {
  if (typeof requestedRoot !== "string" || !requestedRoot) {
    throw new Error(`${label} должен быть указан`);
  }
  const absolute = path.resolve(requestedRoot);
  const stat = await pathState(absolute);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} должен быть существующим обычным каталогом: ${absolute}`);
  }
  return fs.realpath(absolute);
}

/**
 * Проверяет вложенность пути в root.
 *
 * @param {string} root Канонический root.
 * @param {string} candidate Канонический кандидат.
 * @returns {boolean} Принадлежность root с учётом самого root.
 */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * Преобразует POSIX-путь descriptor в путь текущей платформы.
 *
 * @param {string} root Абсолютный root.
 * @param {string} relativePath Проверенный относительный POSIX-путь.
 * @returns {string} Абсолютный путь.
 */
function resolveRelative(root, relativePath) {
  return relativePath === "."
    ? root
    : path.join(root, ...relativePath.split("/"));
}

/**
 * Проверяет отсутствие symlink во всех существующих компонентах source path.
 *
 * @param {string} root Канонический Template root.
 * @param {string} relativePath Относительный путь.
 * @param {string} label Название source.
 * @returns {Promise<import("node:fs").Stats>} Состояние конечного пути.
 */
async function inspectSourcePath(root, relativePath, label) {
  if (relativePath === ".") return fs.lstat(root);
  let current = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await pathState(current);
    if (!stat) throw new Error(`${label} не существует: ${relativePath}`);
    if (stat.isSymbolicLink()) throw new Error(`${label} содержит symlink: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} проходит через файл: ${relativePath}`);
    }
    if (index === segments.length - 1) return stat;
  }
  throw new Error(`${label} не удалось проверить`);
}

/**
 * Рекурсивно перечисляет обычные source files и блокирует специальные объекты.
 *
 * @param {string} root Текущий абсолютный root.
 * @param {string} relativeDirectory Относительный POSIX-каталог.
 * @param {string} label Название copy source.
 * @returns {Promise<Array<{absolute: string, relative: string, mode: number}>>} Файлы source.
 */
async function listSourceFiles(root, relativeDirectory, label) {
  const absoluteDirectory = resolveRelative(root, relativeDirectory || ".");
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolute = path.join(absoluteDirectory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`${label} содержит symlink: ${relative}`);
    if (stat.isDirectory()) files.push(...(await listSourceFiles(root, relative, label)));
    else if (stat.isFile()) files.push({ absolute, relative, mode: stat.mode & 0o777 });
    else throw new Error(`${label} содержит специальный файловый объект: ${relative}`);
  }
  return files;
}

/**
 * Объединяет `to` операции и относительный путь файла.
 *
 * @param {string} destination Операция `to`.
 * @param {string} relativeFile Путь файла внутри source directory.
 * @returns {string} Относительный POSIX target.
 */
function joinTarget(destination, relativeFile) {
  if (!relativeFile) return destination;
  return destination === "." ? relativeFile : `${destination}/${relativeFile}`;
}

/**
 * Запрещает запись в Core-owned project paths.
 *
 * @param {string} relativePath Относительный POSIX-путь.
 * @param {string} label Название поля или target.
 * @returns {void}
 */
function assertNotProtected(relativePath, label) {
  const [root] = relativePath.split("/");
  if (PROTECTED_ROOTS.has(root.toLowerCase())) {
    throw new Error(`${label} пытается использовать защищённый Core path: ${relativePath}`);
  }
}

/**
 * Проверяет file-directory collisions между всеми операциями plan.
 * Повторная запись одного файла разрешена: последняя операция Template побеждает.
 *
 * @param {import("./types.js").TemplatePlanFile[]} files Copy plan.
 * @returns {void}
 */
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
      const existingParent = targets.get(parent.toLowerCase());
      if (existingParent) {
        throw new Error(`Template создаёт file-directory collision: ${existingParent} и ${target}`);
      }
    }
  }
}

/**
 * Проверяет существующие компоненты target, не принимая решение об overwrite файла.
 *
 * @param {string} targetRoot Канонический target root.
 * @param {import("./types.js").TemplatePlanFile} file Элемент plan.
 * @returns {Promise<void>}
 */
async function assertSafeExistingTarget(targetRoot, file) {
  let current = targetRoot;
  const segments = file.targetRelative.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await pathState(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw new Error(`Target содержит symlink: ${file.targetRelative}`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`Target содержит file-directory collision: ${file.targetRelative}`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`Target конфликтует с каталогом или специальным объектом: ${file.targetRelative}`);
    }
  }
}

/**
 * Блокирует symlink в существующей части agent mapping path.
 * Тип конечного объекта проверит операция, которая фактически использует mapping.
 *
 * @param {string} targetRoot Канонический target root.
 * @param {string} relativePath Относительный agent path.
 * @returns {Promise<void>}
 */
async function assertNoTargetSymlink(targetRoot, relativePath) {
  if (relativePath === ".") return;
  let current = targetRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await pathState(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error(`Target содержит symlink: ${relativePath}`);
  }
}

/**
 * Загружает descriptor и полностью рассчитывает безопасный copy plan без записи.
 *
 * @param {object} options Параметры plan.
 * @param {string} [options.templateRoot] Встроенный либо локальный Template root.
 * @param {string} options.targetRoot Корень будущего проекта.
 * @param {string} options.agentId Выбранный agent mapping.
 * @returns {Promise<{
 *   templateRoot: string,
 *   targetRoot: string,
 *   supportedAgentIds: string[],
 *   agent: import("./types.js").TemplateAgent,
 *   files: import("./types.js").TemplatePlanFile[]
 * }>} Проверенный Template plan.
 */
export async function buildTemplatePlan({
  templateRoot: requestedTemplateRoot = BASE_TEMPLATE_ROOT,
  targetRoot: requestedTargetRoot,
  agentId,
}) {
  const templateRoot = await resolveDirectoryRoot(requestedTemplateRoot, "Template root");
  const targetRoot = await resolveDirectoryRoot(requestedTargetRoot, "Target root");
  if (isWithin(templateRoot, targetRoot) || isWithin(targetRoot, templateRoot)) {
    throw new Error("Template root и target root не должны пересекаться");
  }

  await listSourceFiles(templateRoot, "", "Template root");
  const descriptorStat = await inspectSourcePath(templateRoot, "template.yaml", "Template descriptor");
  if (!descriptorStat.isFile()) throw new Error("template.yaml должен быть обычным файлом");
  const descriptor = parseTemplateDescriptor(
    await fs.readFile(path.join(templateRoot, "template.yaml"), "utf8"),
  );
  const supportedAgentIds = Object.keys(descriptor.agents).sort();
  const agent = descriptor.agents[agentId];
  if (!agent) {
    throw new Error(
      `Template не поддерживает agent '${agentId ?? ""}'. Доступны: ${supportedAgentIds.join(", ")}`,
    );
  }

  for (const [label, relativePath] of [
    [`agents.${agent.id}.generated_directory`, agent.generatedDirectory],
    [`agents.${agent.id}.target_directory`, agent.targetDirectory],
    [`agents.${agent.id}.commands_directory`, agent.commandsDirectory],
    [`agents.${agent.id}.instructions_file`, agent.instructionsFile],
    ...Object.entries(agent.handoffs).map(([name, handoffPath]) => [
      `agents.${agent.id}.handoffs.${name}`,
      handoffPath,
    ]),
  ]) {
    assertNotProtected(relativePath, label);
    await assertNoTargetSymlink(targetRoot, relativePath);
  }

  const files = [];
  for (const [operationIndex, operation] of agent.copy.entries()) {
    assertNotProtected(operation.to, `agents.${agent.id}.copy[${operationIndex}].to`);
    const label = `agents.${agent.id}.copy[${operationIndex}].from`;
    const sourceStat = await inspectSourcePath(templateRoot, operation.from, label);
    if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
      throw new Error(`${label} должен быть обычным файлом или каталогом`);
    }
    const sourceFiles = sourceStat.isFile()
      ? [{
          absolute: resolveRelative(templateRoot, operation.from),
          relative: "",
          mode: sourceStat.mode & 0o777,
        }]
      : await listSourceFiles(templateRoot, operation.from === "." ? "" : operation.from, label);
    for (const sourceFile of sourceFiles) {
      const sourceRelative = sourceStat.isFile()
        ? ""
        : sourceFile.relative.slice(operation.from === "." ? 0 : operation.from.length + 1);
      const targetRelative = joinTarget(operation.to, sourceRelative);
      if (targetRelative === ".") {
        throw new Error(`agents.${agent.id}.copy[${operationIndex}].to не может заменить target root`);
      }
      assertNotProtected(targetRelative, `agents.${agent.id}.copy[${operationIndex}]`);
      const canonicalSource = await fs.realpath(sourceFile.absolute);
      if (!isWithin(templateRoot, canonicalSource)) {
        throw new Error(`${label} выходит за Template root`);
      }
      files.push({
        source: canonicalSource,
        target: resolveRelative(targetRoot, targetRelative),
        targetRelative,
        mode: sourceFile.mode,
        operationIndex,
      });
    }
  }

  assertNoPlanCollisions(files);
  for (const file of files) await assertSafeExistingTarget(targetRoot, file);
  return { templateRoot, targetRoot, supportedAgentIds, agent, files };
}
