/** @fileoverview Root MCP Connector command grammar. */

import { createCliProgress } from "@openspec-orch/plugin-sdk";

import { McpConnectorService } from "./service.js";

/** Печатает итог apply без раскрытия server settings. */
function printApply(result, write) {
  write(`MCP Connector: Agent ${result.agentId}`);
  write(`Settings: ${result.settingsPath}`);
  write(`Context: ${result.instructionsPath} (${result.context})`);
  for (const [label, values] of [
    ["Добавлены", result.installed],
    ["Обновлены", result.updated],
    ["Удалены", result.removed],
    ["Приняты под управление", result.adopted],
    ["Без изменений", result.unchanged],
  ]) {
    if (values.length > 0) write(`${label}: ${values.join(", ")}`);
  }
}

/** Печатает read-only status report. */
function printStatus(report, write) {
  const icon = report.state === "ready" ? "✓" : report.state === "unconfigured" ? "•" : "⚠";
  write(`${icon} MCP Connector → ${report.agentId}: ${report.state}`);
  write(`  Config: ${report.configPresent ? report.configPath : "не создан"}`);
  write(`  Settings: ${report.settingsPath}`);
  write(`  Context: ${report.instructionsPath} (${report.context})`);
  for (const server of report.servers) {
    write(`  ${server.status === "ready" ? "✓" : "⚠"} ${server.id}: ${server.status}`);
  }
}

/** Регистрирует root namespace `mcp` через публичный SDK builder. */
export function registerMcpConnectorCommands(
  commands,
  { output = console, progress = createCliProgress() } = {},
) {
  const write = (message) => output.log(message);
  const mcp = commands.command("mcp")
    .description("применить и проверить декларативные MCP settings");
  mcp.command("apply")
    .description("синхронизировать mcp-connector.yaml с settings текущего Agent")
    .actionWithContext(async (context) => {
      const result = await progress.run(
        "Применение MCP Connector...",
        () => new McpConnectorService(context).apply(),
        { success: "MCP settings применены" },
      );
      printApply(result, write);
    }, { scope: "store", requireBinding: false });
  mcp.command("status")
    .description("показать расхождения config, ownership state и Agent settings")
    .option("--json", "вывести машиночитаемый report")
    .actionWithContext(async (context, options) => {
      const report = await new McpConnectorService(context).status();
      if (options.json) write(JSON.stringify(report, null, 2));
      else printStatus(report, write);
    }, { scope: "store", requireBinding: false });
}
