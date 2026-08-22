/** @fileoverview Централизованные изменяемые defaults нового Core. */

export const CORE_SETTINGS = Object.freeze({
  execution: Object.freeze({
    externalCommandTimeoutMs: 120_000,
  }),
  workspace: Object.freeze({
    repositoriesDirectory: "src",
  }),
});
