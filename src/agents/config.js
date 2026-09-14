/** @fileoverview Единственный источник настраиваемой native grammar Agent adapters. */

const CLAUDE_PLUGIN_FILES = Object.freeze({
  directory: ".claude-plugin",
  manifest: "plugin.json",
  marketplace: "marketplace.json",
  marketplaceSource: "./",
  marketplacePrefix: "openspec-orch-",
});

const EXTENSION_CLI_PROTOCOL = Object.freeze({
  commands: Object.freeze({
    group: "extensions",
    list: "list",
    install: "install",
    update: "update",
    enable: "enable",
    disable: "disable",
    uninstall: "uninstall",
  }),
  marketplace: CLAUDE_PLUGIN_FILES,
  defaultActivationScope: "workspace",
  ansiEscape: new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"),
  installationPathLabels: Object.freeze(["Path", "Путь"]),
  statusHeading: Object.freeze({ enabled: "✓", disabled: "✗" }),
});

const CLAUDE_PLUGIN_PROTOCOL = Object.freeze({
  commands: Object.freeze({
    group: "plugin",
    list: "list",
    marketplace: "marketplace",
    add: "add",
    install: "install",
    update: "update",
    uninstall: "uninstall",
    remove: "remove",
  }),
  files: CLAUDE_PLUGIN_FILES,
});

/** Agent-specific selection of a protocol and status vocabulary. */
export const AGENT_ADAPTER_CONFIG = Object.freeze({
  claude: Object.freeze({ protocol: CLAUDE_PLUGIN_PROTOCOL }),
  qwen: Object.freeze({
    protocol: EXTENSION_CLI_PROTOCOL,
    scopeMarkers: Object.freeze({
      user: Object.freeze(["Enabled (User): true"]),
      workspace: Object.freeze(["Enabled (Workspace): true"]),
    }),
  }),
  gigacode: Object.freeze({
    protocol: EXTENSION_CLI_PROTOCOL,
    scopeMarkers: Object.freeze({
      user: Object.freeze(["Enabled (User): true", "Включено (Пользователь): true"]),
      workspace: Object.freeze(["Enabled (Workspace): true", "Включено (Рабочее пространство): true"]),
    }),
  }),
});

/** Installation bookkeeping is native-client metadata, not shipped Extension content. */
export const NATIVE_PAYLOAD_CONFIG = Object.freeze({
  preflightArgs: Object.freeze(["--version"]),
  ignoredDirectoryNames: Object.freeze([".git", "node_modules"]),
  rootBookkeepingFiles: Object.freeze([
    ".qwen-extension-install.json",
    ".gigacode-extension-install.json",
    ".gemini-extension-install.json",
  ]),
});
