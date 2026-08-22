/** @fileoverview Централизованные изменяемые defaults нового Core. */

export const CORE_SETTINGS = Object.freeze({
  execution: Object.freeze({
    externalCommandTimeoutMs: 120_000,
    strictByDefault: true,
  }),
  openSpec: Object.freeze({
    init: Object.freeze({
      delivery: "both",
      profile: "custom",
      workflows: Object.freeze([
        "propose",
        "explore",
        "new",
        "continue",
        "apply",
        "update",
        "ff",
        "sync",
        "archive",
        "bulk-archive",
        "verify",
        "onboard",
      ]),
    }),
  }),
  repositories: Object.freeze({
    processConcurrency: 4,
  }),
  workspace: Object.freeze({
    repositoriesDirectory: "src",
  }),
});
