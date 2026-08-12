/** @fileoverview Реестр поддерживаемых agent adapter и их provider-specific путей. */

const MARKDOWN_COMMAND_ARCHITECTURE = "markdown-commands";
const REQUIRED_SUBAGENTS = Object.freeze(["repository-context-pass.md"]);

const AGENTS = Object.freeze({
  gigacode: Object.freeze({
    id: "gigacode",
    openSpecId: "qwen",
    architecture: MARKDOWN_COMMAND_ARCHITECTURE,
    commandsDirectory: ".gigacode/commands",
    agentsDirectory: ".gigacode/agents",
    requiredSubagents: REQUIRED_SUBAGENTS,
    instructionsFile: ".gigacode/GIGACODE.md",
    templateDirectory: "gigacode",
    generatedDirectory: ".qwen",
  }),
  qwen: Object.freeze({
    id: "qwen",
    openSpecId: "qwen",
    architecture: MARKDOWN_COMMAND_ARCHITECTURE,
    commandsDirectory: ".qwen/commands",
    agentsDirectory: ".qwen/agents",
    requiredSubagents: REQUIRED_SUBAGENTS,
    instructionsFile: "QWEN.md",
    templateDirectory: "qwen",
    generatedDirectory: null,
  }),
});

/**
 * Возвращает ID агентов, для которых SDD гарантирует совместимую архитектуру команд.
 *
 * @returns {string[]} Поддерживаемые agent ID в стабильном порядке конфигурации.
 */
export function supportedAgentIds() {
  return Object.keys(AGENTS);
}

/**
 * Возвращает поддерживаемый SDD-адаптер. OpenSpec умеет больше агентов, но сюда
 * входят только агенты с совместимым форматом Markdown-команд.
 *
 * @param {unknown} id
 * @returns {{
 *   id: string,
 *   openSpecId: string,
 *   architecture: string,
 *   commandsDirectory: string,
 *   agentsDirectory: string,
 *   requiredSubagents: readonly string[],
 *   instructionsFile: string | null,
 *   templateDirectory: string,
 *   generatedDirectory: string | null
 * }}
 */
export function resolveAgentAdapter(id) {
  const adapter = typeof id === "string" ? AGENTS[id] : undefined;
  if (!adapter) {
    throw new Error(
      `Неподдерживаемый agent '${id ?? ""}'. Доступны: ${Object.keys(AGENTS).join(", ")}`,
    );
  }
  return adapter;
}
