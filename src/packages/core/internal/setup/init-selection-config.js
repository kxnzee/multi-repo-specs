/** @fileoverview Статичная UI-конфигурация интерактивного init. */

export const INIT_SELECTION_UI = Object.freeze({
  localTemplateToken: "__local__",
  messages: Object.freeze({
    agent: "Выберите Agent",
    extensions: "Выберите standalone Extensions",
    localTemplate: "Локальный Project Template",
    localTemplatePath: "Путь к локальному Project Template",
    repositoryDescription: (repositoryId) => `Описание Code Repository ${repositoryId} (необязательно)`,
    repositories: "Code Repositories: id=remote#branch через пробел (необязательно)",
    storeBranch: "Default branch основного Store (необязательно)",
    storeDescription: "Описание основного Store (необязательно)",
    storeId: "Store ID",
    storeRemote: "Git remote основного Store (необязательно)",
    template: "Выберите Project Template",
  }),
});
