/** @fileoverview Единый resolver flag и interactive input команды init. */

import process from "node:process";

import { checkbox, confirm, input, select } from "@inquirer/prompts";

import { bundledAgents } from "./bundled-agent.js";
import { configuration } from "./configuration.js";
import { CORE_PATTERNS } from "./constants.js";
import { extensionCatalog } from "./extension-catalog.js";

const LOCAL_TEMPLATE = "__local__";
const CHECKBOX_THEME = Object.freeze({
  icon: Object.freeze({ checked: "[✓]", unchecked: "[ ]" }),
});

/** Приводит Agent и Extension catalogs к одному формату checkbox/select. */
function catalogChoices(catalog) {
  return catalog.entries.map(({ id, name }) => ({ name: `${name} (${id})`, value: id }));
}

/** Нормализует оба режима init до одного immutable domain input. */
export class InitSelectionService {
  #agentCatalog;
  #checkbox;
  #confirm;
  #extensionCatalog;
  #input;
  #select;
  #stdin;
  #stdout;

  constructor({
    agentCatalog: availableAgents = bundledAgents.catalog,
    checkboxPrompt = checkbox,
    confirmPrompt = confirm,
    extensionCatalog: availableExtensions = extensionCatalog,
    inputPrompt = input,
    selectPrompt = select,
    stdin = process.stdin,
    stdout = process.stdout,
  } = {}) {
    if (!availableAgents || !Array.isArray(availableAgents.entries)) {
      throw new Error("INIT_SELECTION_INVALID: agentCatalog должен предоставлять entries");
    }
    if (!availableExtensions || typeof availableExtensions.select !== "function") {
      throw new Error("INIT_SELECTION_INVALID: extensionCatalog должен предоставлять select");
    }
    if ([checkboxPrompt, confirmPrompt, inputPrompt, selectPrompt].some((prompt) => (
      typeof prompt !== "function"
    ))) {
      throw new Error(
        "INIT_SELECTION_INVALID: требуются checkbox/confirm/input/select prompts",
      );
    }
    this.#agentCatalog = availableAgents;
    this.#checkbox = checkboxPrompt;
    this.#confirm = confirmPrompt;
    this.#extensionCatalog = availableExtensions;
    this.#input = inputPrompt;
    this.#select = selectPrompt;
    this.#stdin = stdin;
    this.#stdout = stdout;
    Object.freeze(this);
  }

  /** Выбирает flag mode либо дополняет отсутствующие значения через TTY prompts. */
  async resolve(options = {}) {
    if (options.extensions === false && (options.extension?.length ?? 0) > 0) {
      throw new Error("INIT_SELECTION_INVALID: --extension несовместим с --no-extensions");
    }
    if (options.store !== undefined && options.agent !== undefined) {
      return this.#normalize({
        storeId: options.store,
        agentId: options.agent,
        template: options.template,
        extensionIds: options.extension ?? [],
        extensionsSpecified: options.extensions === false || options.extension !== undefined,
        repositories: options.repo ?? [],
        noStrict: options.strict === false,
      });
    }
    if (!this.#stdin?.isTTY || !this.#stdout?.isTTY) {
      throw new Error(
        "INIT_SELECTION_REQUIRED: non-TTY режим требует --store и --agent; " +
          "используйте флаги или запустите init в интерактивном терминале",
      );
    }
    if (this.#agentCatalog.entries.length === 0) {
      throw new Error("AGENT_NOT_DISCOVERED: интерактивный каталог Agent пуст");
    }
    const storeId = options.store ?? await this.#input({
      message: "Store ID",
      validate: (value) => CORE_PATTERNS.id.test(value) || "Используйте lowercase kebab-case",
    });
    const template = await this.#template(options.template);
    const agentId = options.agent ?? await this.#select({
      message: "Выберите Agent",
      choices: catalogChoices(this.#agentCatalog),
    });
    const extensionIds = options.extensions === false
      ? []
      : options.extension ?? await this.#checkbox({
        message: "Выберите standalone Extensions",
        theme: CHECKBOX_THEME,
        choices: catalogChoices(this.#extensionCatalog),
      });
    const repositories = options.repo ?? await this.#repositories();
    const noStrict = options.strict === false
      ? true
      : !await this.#confirm({ message: "Использовать strict mode?", default: true });
    const normalized = this.#normalize({
      storeId,
      agentId,
      template,
      extensionIds,
      extensionsSpecified: true,
      repositories,
      noStrict,
    });
    const accepted = await this.#confirm({
      message: `${this.#summary(normalized)}. Продолжить инициализацию?`,
      default: true,
    });
    return accepted ? normalized : null;
  }

  #normalize({
    storeId,
    agentId,
    template,
    extensionIds,
    extensionsSpecified,
    repositories,
    noStrict,
  }) {
    const extensions = this.#extensionCatalog
      .select(extensionIds)
      .map(({ id, source }) => ({ id, source }));
    return Object.freeze({
      storeId,
      agentId,
      template,
      extensions,
      extensionsSpecified,
      repositories: Object.freeze([...repositories]),
      noStrict,
    });
  }

  #parseRepositories(source) {
    const trimmed = source.trim();
    if (!trimmed) return [];
    return trimmed.split(/\s+/u).map((value) => configuration.parseRepositoryArgument(value));
  }

  async #repositories() {
    const source = await this.#input({
      message: "Code Repositories: id=remote#branch через пробел (необязательно)",
      validate: (value) => {
        try {
          this.#parseRepositories(value);
          return true;
        } catch (error) {
          return error.message;
        }
      },
    });
    return this.#parseRepositories(source);
  }

  #summary(selection) {
    return [
      `Store: ${selection.storeId}`,
      `Template: ${selection.template ?? "base"}`,
      `Agent: ${selection.agentId}`,
      `Extensions: ${selection.extensions.map(({ id }) => id).join(", ") || "нет"}`,
      `Code Repositories: ${selection.repositories.map(({ id }) => id).join(", ") || "нет"}`,
      `Mode: ${selection.noStrict ? "relaxed" : "strict"}`,
    ].join("; ");
  }

  async #template(selected) {
    let template = selected ?? await this.#select({
      message: "Выберите Project Template",
      choices: [
        { name: "Base (base)", value: "base" },
        { name: "Локальный Project Template", value: LOCAL_TEMPLATE },
      ],
    });
    if (template === LOCAL_TEMPLATE) {
      template = await this.#input({
        message: "Путь к локальному Project Template",
        validate: (value) => value.trim().length > 0 || "Укажите путь",
      });
    }
    return template;
  }
}

/** Пустой resolver по умолчанию; composition root передаёт distribution catalogs. */
export const initSelections = Object.freeze(new InitSelectionService());
