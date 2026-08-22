/** @fileoverview Независимый sample Plugin для проверки публичного SDK. */

import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "sample",
  supports: ["code"],
  repository: {
    async connect() {},
    async status() {
      return { state: "ready" };
    },
  },
  registerCommands(commands) {
    commands.command("hello")
      .description("Sample command")
      .action(async () => {});
  },
});
