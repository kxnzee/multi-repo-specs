/** @fileoverview Единый resolver flag и interactive input команды init. */

import process from "node:process";

import { checkbox, confirm, input, select } from "@inquirer/prompts";

import { bundledAgents } from "./bundled-agent.js";
import { bundledTemplates } from "./bundled-template.js";
import { configuration } from "./configuration.js";
import { CORE_EXECUTION_MODE, CORE_PATTERNS } from "./constants.js";
import { extensionCatalog } from "./extension-catalog.js";
import { INIT_SELECTION_UI } from "./init-selection-config.js";
import { REQUIRED_CHECKBOX_THEME } from "./prompt-config.js";

const { localTemplateToken, messages } = INIT_SELECTION_UI;

/** Приводит Agent и Extension catalogs к одному формату checkbox/select. */
function catalogChoices(catalog) {
  return catalog.entries.map(({ id, name }) => ({ name: `${name} (${id})`, value: id }));
}

/** Показывает Template вместе с его обязательным Extension-профилем. */
function templateChoices(catalog) {
  return catalog.entries.map(({ id, name, requiredExtensions = [] }) => {
    const profile = requiredExtensions.length === 0
      ? `${name} (${id})`
      : `${name} (${id}) — требует: ${requiredExtensions.join(", ")}`;
    return { name: profile, value: id };
  });
}

/** Нормализует оба режима init до одного immutable domain input. */
export class InitSelectionService {
  #agentCatalog;
  #checkbox;
  #confirm;
  #defaultTemplateId;
  #extensionCatalog;
  #input;
  #select;
  #stdin;
  #stdout;
  #templateCatalog;

  constructor({
    agentCatalog: availableAgents = bundledAgents.catalog,
    checkboxPrompt = checkbox,
    confirmPrompt = confirm,
    defaultTemplateId = bundledTemplates.defaultId,
    extensionCatalog: availableExtensions = extensionCatalog,
    inputPrompt = input,
    selectPrompt = select,
    stdin = process.stdin,
    stdout = process.stdout,
    templateCatalog: availableTemplates = bundledTemplates.catalog,
  } = {}) {
    if (!availableAgents || !Array.isArray(availableAgents.entries)) {
      throw new Error("INIT_SELECTION_INVALID: agentCatalog должен предоставлять entries");
    }
    if (!availableExtensions || typeof availableExtensions.select !== "function") {
      throw new Error("INIT_SELECTION_INVALID: extensionCatalog должен предоставлять select");
    }
    if (
      !availableTemplates ||
      !Array.isArray(availableTemplates.entries) ||
      typeof availableTemplates.requiredExtensionsFor !== "function"
    ) {
      throw new Error(
        "INIT_SELECTION_INVALID: templateCatalog должен предоставлять entries и requirements",
      );
    }
    if (typeof defaultTemplateId !== "string" || !CORE_PATTERNS.id.test(defaultTemplateId)) {
      throw new Error("INIT_SELECTION_INVALID: defaultTemplateId должен быть lowercase kebab-case");
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
    this.#defaultTemplateId = defaultTemplateId;
    this.#extensionCatalog = availableExtensions;
    this.#input = inputPrompt;
    this.#select = selectPrompt;
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#templateCatalog = availableTemplates;
    Object.freeze(this);
  }

  /** Выбирает flag mode либо дополняет отсутствующие значения через TTY prompts. */
  async resolve(options = {}) {
    if (options.extensions === false && (options.extension?.length ?? 0) > 0) {
      throw new Error("INIT_SELECTION_INVALID: --extension несовместим с --no-extensions");
    }
    if (options.store !== undefined && options.agent !== undefined) {
      this.#assertExtensionsEnabled(options.template, options.extensions);
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
      message: messages.storeId,
      validate: (value) => CORE_PATTERNS.id.test(value) || "Используйте lowercase kebab-case",
    });
    const template = await this.#template(options.template);
    this.#assertExtensionsEnabled(template, options.extensions);
    const agentId = options.agent ?? await this.#select({
      message: messages.agent,
      choices: catalogChoices(this.#agentCatalog),
    });
    const extensionChoices = this.#extensionChoices(template);
    const extensionIds = options.extensions === false
      ? []
      : options.extension ?? (extensionChoices.some(({ disabled }) => !disabled)
        ? await this.#checkbox({
            message: messages.extensions,
            theme: REQUIRED_CHECKBOX_THEME,
            choices: extensionChoices,
          })
        : []);
    const repositories = options.repo ?? await this.#repositories();
    const noStrict = options.strict === false
      ? true
      : !await this.#confirm({ message: messages.strictMode, default: true });
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
    const requiredExtensionIds = this.#requiredExtensionIds(template);
    const selectedExtensionIds = [...new Set([...requiredExtensionIds, ...extensionIds])];
    const extensions = this.#extensionCatalog
      .select(selectedExtensionIds)
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
      message: messages.repositories,
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
    const templateId = this.#templateId(selection.template);
    return [
      `Store: ${selection.storeId}`,
      `Template: ${templateId}`,
      `Agent: ${selection.agentId}`,
      `Extensions: ${selection.extensions.map(({ id }) => id).join(", ") || "нет"}`,
      `Code Repositories: ${selection.repositories.map(({ id }) => id).join(", ") || "нет"}`,
      `Mode: ${selection.noStrict ? CORE_EXECUTION_MODE.relaxed : CORE_EXECUTION_MODE.strict}`,
    ].join("; ");
  }

  #requiredExtensionIds(template) {
    return this.#templateCatalog.requiredExtensionsFor(this.#templateId(template));
  }

  #assertExtensionsEnabled(template, extensionsOption) {
    const templateId = this.#templateId(template);
    const requiredExtensionIds = this.#requiredExtensionIds(template);
    if (extensionsOption === false && requiredExtensionIds.length > 0) {
      throw new Error(
        `TEMPLATE_REQUIRES_EXTENSION: Template ${templateId} требует ` +
          requiredExtensionIds.join(", "),
      );
    }
  }

  #extensionChoices(template) {
    const templateId = this.#templateId(template);
    const requiredExtensionIds = new Set(this.#requiredExtensionIds(templateId));
    return catalogChoices(this.#extensionCatalog).map((choice) => requiredExtensionIds.has(choice.value)
      ? {
          ...choice,
          checked: true,
          disabled: `Требуется Project Template ${templateId}`,
        }
      : choice);
  }

  async #template(selected) {
    let template = selected ?? await this.#select({
      message: messages.template,
      choices: [
        ...templateChoices(this.#templateCatalog),
        { name: messages.localTemplate, value: localTemplateToken },
      ],
    });
    if (template === localTemplateToken) {
      template = await this.#input({
        message: messages.localTemplatePath,
        validate: (value) => value.trim().length > 0 || "Укажите путь",
      });
    }
    return template;
  }

  #templateId(template) {
    return template ?? this.#defaultTemplateId;
  }
}

/** Пустой resolver по умолчанию; composition root передаёт distribution catalogs. */
export const initSelections = Object.freeze(new InitSelectionService());
