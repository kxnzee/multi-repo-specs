/** @fileoverview Runtime agent mappings used only by tests. */

const AGENTS = Object.freeze({
  qwen: Object.freeze({
    id: "qwen",
    openSpecId: "qwen",
    architecture: "markdown-commands",
    generatedDirectory: ".qwen",
    targetDirectory: ".qwen",
    commandsDirectory: ".qwen/commands",
    instructionsFile: "QWEN.md",
    handoffs: Object.freeze({
      explore: ".sdd/instructions/explore.md",
      apply: ".qwen/commands/sdd-apply.md",
    }),
  }),
  gigacode: Object.freeze({
    id: "gigacode",
    openSpecId: "qwen",
    architecture: "markdown-commands",
    generatedDirectory: ".qwen",
    targetDirectory: ".gigacode",
    commandsDirectory: ".gigacode/commands",
    instructionsFile: ".gigacode/GIGACODE.md",
    handoffs: Object.freeze({
      explore: ".sdd/instructions/explore.md",
      apply: ".gigacode/commands/sdd-apply.md",
    }),
  }),
});

/**
 * @param {"qwen" | "gigacode"} id Agent fixture ID.
 * @returns {typeof AGENTS.qwen}
 */
export function agentFixture(id) {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`Unknown test agent: ${id}`);
  return agent;
}
