/** @fileoverview Reconciliation of Project Template Plugin requirements. */

import { storeProjects } from "./store-project.js";

/** Fails one invalid Template requirement boundary. */
function invalid(message) {
  throw new Error(`PLUGIN_REQUIREMENTS_INVALID: ${message}`);
}

/** Immutable result of reconciling required Plugin extensions. */
export class PluginRequirementsResult {
  #initialized;
  #required;

  constructor({ initialized, required }) {
    this.#initialized = Object.freeze([...initialized]);
    this.#required = Object.freeze([...required]);
    Object.freeze(this);
  }

  get initialized() { return this.#initialized; }
  get required() { return this.#required; }
}

/** Resolves Template Plugin IDs through the catalog and reuses normal Plugin installation. */
export class PluginRequirementsService {
  #applications;
  #catalog;
  #storeProjects;

  constructor({ applicationService, catalog, storeProjectService = storeProjects } = {}) {
    if (
      typeof applicationService?.install !== "function" ||
      typeof applicationService?.setRequiredPlugins !== "function"
    ) {
      invalid("applicationService должен предоставлять install и setRequiredPlugins");
    }
    if (typeof catalog?.select !== "function") invalid("catalog должен предоставлять select");
    if (typeof storeProjectService?.load !== "function") {
      invalid("storeProjectService должен предоставлять load");
    }
    this.#applications = applicationService;
    this.#catalog = catalog;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async reconcile(storeRoot, requiredPluginIds) {
    if (typeof storeRoot !== "string" || storeRoot.length === 0) {
      invalid("storeRoot обязателен");
    }
    const selections = this.#catalog.select(requiredPluginIds);
    const initialized = [];
    for (const { id, source } of selections) {
      const current = await this.#storeProjects.load(storeRoot);
      const result = await this.#applications.install(current, id, source, { required: true });
      if (result.initialized) initialized.push(id);
    }
    const current = await this.#storeProjects.load(storeRoot);
    await this.#applications.setRequiredPlugins(current, selections.map(({ id }) => id));
    return new PluginRequirementsResult({
      initialized,
      required: selections.map(({ id }) => id),
    });
  }
}
