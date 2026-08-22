/** @fileoverview Общие выбор и bounded-concurrency обработка Core Repositories. */

import pMap from "p-map";

import { Project } from "./project.js";
import { Repository } from "./repository.js";
import { CORE_SETTINGS } from "./settings.js";

const REPOSITORY_ROLES = new Set(["store", "code"]);

/** Выбирает Repository handles в стабильном проектном порядке. */
export class RepositorySelector {
  select(project, { repositoryIds, roles } = {}) {
    if (!(project instanceof Project)) {
      throw new Error("REPOSITORY_SELECTION_INVALID: требуется Project");
    }
    if (repositoryIds !== undefined && !Array.isArray(repositoryIds)) {
      throw new Error("REPOSITORY_SELECTION_INVALID: repositoryIds должен быть массивом");
    }
    if (roles !== undefined && !Array.isArray(roles)) {
      throw new Error("REPOSITORY_SELECTION_INVALID: roles должен быть массивом");
    }
    const selectedRoles = new Set(roles ?? []);
    for (const role of selectedRoles) {
      if (!REPOSITORY_ROLES.has(role)) {
        throw new Error(`REPOSITORY_SELECTION_INVALID: неизвестная role '${role}'`);
      }
    }
    const selected = project.selectRepositories(repositoryIds);
    return Object.freeze(selected.filter((repository) => (
      selectedRoles.size === 0 || selectedRoles.has(repository.role)
    )));
  }
}

/** Выполняет одну Repository operation с общим ограничением параллелизма. */
export class RepositoryRunner {
  #concurrency;

  constructor({ concurrency = CORE_SETTINGS.repositories.processConcurrency } = {}) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("REPOSITORY_RUNNER_INVALID: concurrency должен быть положительным integer");
    }
    this.#concurrency = concurrency;
    Object.freeze(this);
  }

  get concurrency() {
    return this.#concurrency;
  }

  async run(repositories, operation) {
    if (!Array.isArray(repositories)) {
      throw new Error("REPOSITORY_RUNNER_INVALID: repositories должен быть массивом");
    }
    if (typeof operation !== "function") {
      throw new Error("REPOSITORY_RUNNER_INVALID: operation должна быть функцией");
    }
    const selected = [...repositories];
    if (selected.some((repository) => !(repository instanceof Repository))) {
      throw new Error("REPOSITORY_RUNNER_INVALID: требуется Repository handle");
    }
    if (new Set(selected.map(({ id }) => id)).size !== selected.length) {
      throw new Error("REPOSITORY_RUNNER_INVALID: repository IDs не должны повторяться");
    }
    const results = await pMap(selected, operation, { concurrency: this.#concurrency });
    return Object.freeze(results);
  }
}

/** Общие singleton facades нового Core. */
export const repositorySelector = Object.freeze(new RepositorySelector());
export const repositoryRunner = Object.freeze(new RepositoryRunner());
