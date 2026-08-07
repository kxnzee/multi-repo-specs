/** @fileoverview Безопасное объединение общих проектных файлов при init. */

import { promises as fs } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Добавляет текстовый блок с одной пустой строкой.
 *
 * @param {string} current Текущее содержимое.
 * @param {string} block Новый блок.
 * @returns {string} Объединённое содержимое.
 */
function appendBlock(current, block) {
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block.trim()}\n`;
}

/**
 * Дополняет `.gitignore` или `CODEOWNERS`, не затирая проектные правила.
 *
 * @param {string} source Путь шаблона.
 * @param {string} destination Путь проектного файла.
 * @param {string} relativePath Относительный путь.
 * @returns {Promise<boolean>} Был ли файл изменён.
 */
export async function mergeSharedProjectFile(source, destination, relativePath) {
  const [current, template] = await Promise.all([
    fs.readFile(destination, "utf8"),
    fs.readFile(source, "utf8"),
  ]);
  if (relativePath === ".gitignore") {
    const existingRules = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missingRules = template
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !existingRules.has(line));
    if (missingRules.length === 0) return false;
    await fs.writeFile(destination, appendBlock(current, `# SDD local data\n${missingRules.join("\n")}`), "utf8");
    return true;
  }
  if (current.includes(template.trim())) return false;
  await fs.writeFile(destination, appendBlock(current, template), "utf8");
  return true;
}

/**
 * Добавляет обязательный SDD-контекст, сохраняя OpenSpec-настройки проекта.
 *
 * @param {string} source Путь шаблона.
 * @param {string} destination Путь `openspec/config.yaml`.
 * @returns {Promise<boolean>} Был ли файл изменён.
 */
export async function mergeOpenSpecConfig(source, destination) {
  const destinationStat = await fs.lstat(destination);
  if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
    throw new Error("openspec/config.yaml должен быть обычным файлом");
  }
  const [currentSource, templateSource] = await Promise.all([
    fs.readFile(destination, "utf8"),
    fs.readFile(source, "utf8"),
  ]);
  const current = parseYaml(currentSource) ?? {};
  const template = parseYaml(templateSource);
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("openspec/config.yaml должен содержать YAML-объект");
  }
  if (current.store !== undefined) {
    throw new Error("Центральный Store не может содержать pointer store: в openspec/config.yaml");
  }
  if (current.schema !== undefined && current.schema !== "spec-driven") {
    throw new Error("Для принятия проекта требуется schema: spec-driven в openspec/config.yaml");
  }
  if (current.rules !== undefined && (!current.rules || typeof current.rules !== "object" || Array.isArray(current.rules))) {
    throw new Error("openspec/config.yaml: rules должен быть YAML-объектом");
  }
  current.schema = "spec-driven";
  const requiredContext = template.context.trim();
  const existingContext = typeof current.context === "string" ? current.context.trim() : "";
  if (!existingContext.includes(requiredContext)) {
    current.context = existingContext ? `${existingContext}\n\n${requiredContext}` : requiredContext;
  }
  current.rules ??= {};
  for (const [artifact, rules] of Object.entries(template.rules)) {
    const existingRules = Array.isArray(current.rules[artifact]) ? current.rules[artifact] : [];
    current.rules[artifact] = [...existingRules, ...rules.filter((rule) => !existingRules.includes(rule))];
  }
  const merged = stringifyYaml(current, { lineWidth: 0 });
  if (merged === currentSource) return false;
  await fs.writeFile(destination, merged, "utf8");
  return true;
}
