/** @fileoverview Общие JSDoc-типы для машинных данных OpenSpec Orchestrator и OpenSpec. */

/**
 * Корень OpenSpec, разрешённый официальным CLI.
 *
 * @typedef {object} OpenSpecRoot
 * @property {string} path
 * @property {string} [store_id]
 * @property {string} source
 * @property {boolean} [healthy]
 */

/**
 * Диагностика из машинного ответа OpenSpec.
 *
 * @typedef {object} OpenSpecDiagnostic
 * @property {string} [code]
 * @property {string} [message]
 * @property {"error" | "warning" | "info"} [severity]
 */

/**
 * Минимальная identity центрального Store.
 *
 * @typedef {object} StoreMetadata
 * @property {number} version
 * @property {string} id
 * @property {string} [remote]
 */

/**
 * Проверенный машинный ответ OpenSpec.
 *
 * @typedef {Record<string, unknown> & {
 *   root?: OpenSpecRoot,
 *   status?: OpenSpecDiagnostic[]
 * }} OpenSpecResponse
 */

/**
 * Результат подключения одного Code Repository.
 *
 * @typedef {object} ConnectedRepository
 * @property {string} id
 * @property {string} path
 * @property {string} branch
 * @property {string} revision
 * @property {boolean} cloned
 * @property {boolean} pointerCreated
 * @property {boolean} pointerPending
 * @property {"ready" | "needs_setup_pr"} status
 */

/**
 * Результат подключения multi-repo workspace.
 *
 * @typedef {object} ConnectResult
 * @property {string} storeId
 * @property {string} storeRoot
 * @property {string} workspace
 * @property {"strict" | "relaxed"} executionMode
 * @property {"ready" | "needs_setup_pr"} status
 * @property {ConnectedRepository[]} repositories
 */

/**
 * Начальный контекст Explore.
 *
 * @typedef {object} ExploreStartContext
 * @property {string} projectRoot
 * @property {string | null} codeRoot
 * @property {{doctor: OpenSpecResponse, context: OpenSpecResponse} | null} discovery
 */

/**
 * Результат инициализации центрального Store.
 *
 * @typedef {object} InitResult
 * @property {string} target
 * @property {string} storeId
 * @property {boolean} alreadyInitialized
 * @property {"strict" | "relaxed"} executionMode
 * @property {string[]} created
 * @property {string[]} updated
 */

/**
 * Репозиторий из нормализованного openspec-orch.yaml.
 *
 * @typedef {object} RegisteredRepository
 * @property {string} id
 * @property {string} url
 * @property {string} defaultBranch
 */

/** @typedef {RegisteredRepository & {path: string}} ResolvedRepository */

/**
 * Зафиксированное состояние чистого Git checkout.
 *
 * @typedef {object} GitState
 * @property {string} branch
 * @property {string} revision
 */

/**
 * Проверенный технический вход агентского Explore.
 *
 * @typedef {object} ExplorePreparation
 * @property {string} ticket
 * @property {string} projectRoot
 * @property {string} storeRepositoryId
 * @property {GitState} store
 * @property {string} workspace
 * @property {boolean} projectSpecsOnly
 * @property {Array<{id: string, path: string, branch: string, revision: string}>} repositories
 * @property {string} exploreInstructionsPath
 * @property {"strict" | "relaxed"} executionMode
 */

/**
 * Результат создания или безопасного продолжения каркаса Change.
 *
 * @typedef {object} ChangePreparation
 * @property {"created" | "existing"} changeStatus
 * @property {"strict" | "relaxed"} executionMode
 * @property {string} storeId
 * @property {string} storeRoot
 * @property {string} ticket
 * @property {string} changeId
 * @property {string | null} branch
 * @property {string} baseRevision
 * @property {string} changePath
 * @property {string} schema
 * @property {Record<string, unknown> | null} nextArtifact
 * @property {OpenSpecResponse} openSpecStatus
 */

/**
 * Результат подготовки одного Code Repository к реализации.
 *
 * @typedef {object} LoadPreparation
 * @property {"implementation_ready"} stepStatus
 * @property {"strict" | "relaxed"} executionMode
 * @property {string} storeId
 * @property {string} changeId
 * @property {string} specBaseline
 * @property {string} repositoryId
 * @property {string | null} implementationBranch
 * @property {"created" | "tracking" | "existing" | "unmanaged"} branchStatus
 * @property {string} codeBaseRevision
 * @property {string} schema
 * @property {"package" | "whole-change"} implementationMode
 * @property {string} changePath
 * @property {Record<string, string[]>} contextFiles
 * @property {string[]} workPackages
 * @property {Array<{id: string, description: string}>} selectedTasks
 * @property {"06"} nextStep
 * @property {string} nextAction
 * @property {string} runtimePath
 */

export {};
