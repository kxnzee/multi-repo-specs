/** @fileoverview Shared in-memory Store PluginContext for Change Tracking tests. */

/** Creates a stateful Store context without filesystem or Git subprocesses. */
export function assignmentContext({
  activeChanges = ["checkout-flow"],
  changedPaths = [],
  connected = ["frontend", "backend"],
  impactRepositories = ["frontend", "backend"],
  implementationAvailable = true,
  implementationHead = "a".repeat(40),
  implementationHeads = null,
  invocation = null,
  openSpecVersion = "1.11.0",
  applyReady = true,
  planningRevision = "a".repeat(40),
  repositoryChangedPaths = [],
} = {}) {
  const values = new Map();
  if (impactRepositories !== null) {
    values.set("openspec/changes/checkout-flow/proposal.md", [
      "# Checkout flow",
      "",
      "## Repository Impact",
      "",
      "| Repository | Capabilities |",
      "|---|---|",
      ...impactRepositories.map((repositoryId) => `| ${repositoryId} | checkout |`),
      "",
    ].join("\n"));
  }
  let stateDocument = null;
  const repositories = new Map([
    ["specs", Object.freeze({ id: "specs", role: "store" })],
    ["frontend", Object.freeze({ id: "frontend", role: "code" })],
    ["backend", Object.freeze({ id: "backend", role: "code" })],
  ]);
  return Object.freeze({
    invocation,
    repository: repositories.get("specs"),
    repositories: Object.freeze({
      require(repositoryId) {
        const repository = repositories.get(repositoryId);
        if (!repository) throw new Error(`REPO_UNKNOWN: ${repositoryId}`);
        return repository;
      },
      isConnected(repositoryId) {
        return connected.includes(repositoryId);
      },
      requireConnected(repositoryIds) {
        for (const repositoryId of repositoryIds) {
          if (!connected.includes(repositoryId)) {
            throw new Error(`PLUGIN_NOT_CONNECTED: change-tracking не подключён к ${repositoryId}`);
          }
        }
        return Object.freeze(repositoryIds.map((repositoryId) => repositories.get(repositoryId)));
      },
      async git(repositoryId) {
        this.requireConnected([repositoryId]);
        return Object.freeze({
          async revision() { return implementationHeads?.[repositoryId] ?? implementationHead; },
          async isRemoteReachable() { return false; },
          async hasCommit() { return implementationAvailable; },
          async statusPaths() { return repositoryChangedPaths; },
        });
      },
    }),
    git: Object.freeze({
      async assertNoOperation() {},
      async statusPaths() { return changedPaths; },
      async revision() { return "a".repeat(40); },
      async latestRevision() { return planningRevision; },
    }),
    process: Object.freeze({
      async run(executable, args) {
        if (executable !== "openspec") throw new Error(`unexpected executable ${executable}`);
        if (args[0] === "--version") return openSpecVersion;
        if (args[0] === "status" && args.includes("--all")) {
          return JSON.stringify({
            changes: activeChanges.map((changeName) => ({ changeName })),
          });
        }
        if (args[0] === "status" && args.includes("--change")) {
          return JSON.stringify({
            changeName: args[args.indexOf("--change") + 1],
            artifacts: [
              { id: "proposal", status: "done", requires: [] },
              { id: "tasks", status: applyReady ? "done" : "ready", requires: ["proposal"] },
              { id: "verify", status: "ready", requires: ["tasks"] },
            ],
            applyRequires: ["tasks"],
            isPlanningComplete: false,
          });
        }
        throw new Error(`unexpected openspec args ${args.join(" ")}`);
      },
    }),
    files: Object.freeze({
      async listDirectories(relativePath, { optional } = {}) {
        const prefix = `${relativePath}/`;
        const names = [...new Set([...values.keys()]
          .filter((value) => value.startsWith(prefix) && value.slice(prefix.length).includes("/"))
          .map((value) => value.slice(prefix.length).split("/")[0]))]
          .sort();
        if (names.length === 0 && !optional) throw new Error(`missing ${relativePath}`);
        return Object.freeze(names);
      },
      async listFiles(relativePath, { optional } = {}) {
        const prefix = `${relativePath}/`;
        const names = [...values.keys()]
          .filter((value) => value.startsWith(prefix) && !value.slice(prefix.length).includes("/"))
          .map((value) => value.slice(prefix.length))
          .sort();
        if (names.length === 0 && !optional) throw new Error(`missing ${relativePath}`);
        return Object.freeze(names);
      },
      async read(relativePath, { optional } = {}) {
        if (values.has(relativePath)) return values.get(relativePath);
        if (optional) return null;
        throw new Error(`missing ${relativePath}`);
      },
      async write(relativePath, contents) { values.set(relativePath, contents); },
    }),
    storage: Object.freeze({
      async read() { return stateDocument; },
      async update(operation) {
        stateDocument = await operation(stateDocument);
        return stateDocument;
      },
    }),
  });
}
