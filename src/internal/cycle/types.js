/** @fileoverview JSDoc-типы Cycle Record Alpha v1 и операций `assign`/`status`. */

/**
 * Cycle Record `.openspec-orch/changes/<change-key>.json`.
 *
 * @typedef {object} CycleRecord
 * @property {number} contractVersion
 * @property {string} cycleId
 * @property {string} changeId
 * @property {string} planningRevision
 * @property {string[]} repositories
 * @property {string} createdAt
 */

/**
 * Preview будущей записи, показываемый перед интерактивным подтверждением `assign`.
 *
 * @typedef {object} AssignPreview
 * @property {"create" | "replace"} kind
 * @property {string} changeId
 * @property {string} path
 * @property {string} planningRevision
 * @property {string[]} repositories
 * @property {CycleRecord} [existing]
 */

/**
 * Итог выполнения `assign`.
 *
 * @typedef {object} AssignResult
 * @property {"created" | "replaced" | "unchanged" | "cancelled"} status
 * @property {string} path
 * @property {CycleRecord} [cycle]
 */

/**
 * Итог выполнения `status`.
 *
 * @typedef {object} StatusResult
 * @property {string} changeId
 * @property {CycleRecord} cycle
 * @property {boolean} committed
 * @property {string} path
 * @property {string} nextAction
 */

export {};
