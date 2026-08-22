/** @fileoverview Единая точка настройки изменяемых defaults проекта. */

const OPEN_SPEC_INIT_WORKFLOWS = Object.freeze([
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
]);

/**
 * Настройки, которые разработчик может менять централизованно. Изменение этих
 * значений может менять создаваемый config, layout или эксплуатационное поведение.
 * Статические версии, regex и служебные пути находятся отдельно в constants.js.
 */
export const PROJECT_SETTINGS = Object.freeze({
  execution: Object.freeze({
    strictByDefault: true,
    externalCommandTimeoutMs: 120_000,
  }),
  workspace: Object.freeze({
    repositoriesDirectory: "src",
  }),
  plugins: Object.freeze({
    processConcurrency: 4,
  }),
  openSpec: Object.freeze({
    init: Object.freeze({
      profile: "custom",
      delivery: "both",
      workflows: OPEN_SPEC_INIT_WORKFLOWS,
    }),
  }),
});
