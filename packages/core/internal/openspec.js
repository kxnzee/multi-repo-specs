/** @fileoverview OpenSpec facade одного проверенного RepositoryCheckout. */

import { processes } from "./process.js";

/** OpenSpec CLI, привязанный к одному Repository checkout. */
export class RepositoryOpenSpec {
  #process;

  constructor(scopedProcess) {
    this.#process = scopedProcess;
    Object.freeze(this);
  }

  execute(args, options = {}) {
    return this.#process.run("openspec", args, options);
  }
}

/** Factory ограниченных OpenSpec facades. */
export class OpenSpecService {
  #processService;

  constructor(processService = processes) {
    this.#processService = processService;
    Object.freeze(this);
  }

  forRepository(checkout) {
    return new RepositoryOpenSpec(this.#processService.forRepository(checkout));
  }
}

/** Общий OpenSpecService нового Core. */
export const openspec = Object.freeze(new OpenSpecService());
