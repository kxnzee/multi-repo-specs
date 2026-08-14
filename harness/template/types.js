/** @fileoverview JSDoc-типы Project Template engine. */

/**
 * @typedef {object} TemplateCopyOperation
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {object} TemplateAgent
 * @property {string} id
 * @property {string} openSpecId
 * @property {"markdown-commands"} architecture
 * @property {string} generatedDirectory
 * @property {string} targetDirectory
 * @property {string} commandsDirectory
 * @property {string} instructionsFile
 * @property {Record<string, string>} handoffs
 * @property {TemplateCopyOperation[]} copy
 */

/**
 * @typedef {object} ProjectTemplateDescriptor
 * @property {Record<string, TemplateAgent>} agents
 */

/**
 * @typedef {object} TemplatePlanFile
 * @property {string} source Абсолютный канонический путь исходного файла.
 * @property {string} target Абсолютный путь назначения.
 * @property {string} targetRelative Безопасный относительный POSIX-путь назначения.
 * @property {number} mode POSIX permission bits исходного файла.
 * @property {number} operationIndex Индекс операции `copy`.
 */

export {};
