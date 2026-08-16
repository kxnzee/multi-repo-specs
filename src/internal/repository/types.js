/** @fileoverview JSDoc-типы read-only `repository status`. */

/**
 * Проверенное только чтением состояние одного репозитория реестра.
 *
 * @typedef {object} RepositoryStatus
 * @property {string} id
 * @property {"store" | "code"} role
 * @property {string | null} path
 * @property {boolean} connected
 * @property {"connected" | "diverged" | "missing" | "not_a_directory" | "not_a_git_repository" | "not_a_git_root" | "workspace_unresolved"} state
 * @property {string} [remote]
 * @property {boolean} [remoteMatches]
 * @property {string} [branch]
 * @property {boolean} [branchMatches]
 * @property {boolean} [clean]
 */

export {};
