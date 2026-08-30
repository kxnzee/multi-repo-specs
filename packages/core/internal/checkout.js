/** @fileoverview Доменная связка Repository и его канонического checkout root. */

import path from "node:path";

/** Проверенный локальный checkout конкретного Repository. */
export class RepositoryCheckout {
  #repository;
  #root;

  constructor(repository, root) {
    if (!repository || typeof repository.id !== "string") {
      throw new Error("REPOSITORY_CHECKOUT_INVALID: Repository обязателен");
    }
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new Error(`REPOSITORY_CHECKOUT_INVALID: root должен быть абсолютным путём: ${root}`);
    }
    this.#repository = repository;
    this.#root = path.normalize(root);
    Object.freeze(this);
  }

  get repository() {
    return this.#repository;
  }

  get root() {
    return this.#root;
  }

  get id() {
    return this.#repository.id;
  }

  get role() {
    return this.#repository.role;
  }
}

/** Создаёт RepositoryCheckout через публичный функциональный фасад. */
export function createRepositoryCheckout(repository, root) {
  return new RepositoryCheckout(repository, root);
}
