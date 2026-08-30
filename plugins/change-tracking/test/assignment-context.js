/** @fileoverview Shared in-memory Store PluginContext for Change Tracking tests. */

/** Creates a stateful Store context without filesystem or Git subprocesses. */
export function assignmentContext({
  changedPaths = [],
  connected = ["frontend", "backend"],
  implementationAvailable = true,
  implementationHead = "a".repeat(40),
  invocation = null,
} = {}) {
  const values = new Map();
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
          async revision() { return implementationHead; },
          async hasCommit() { return implementationAvailable; },
        });
      },
    }),
    git: Object.freeze({
      async assertNoOperation() {},
      async statusPaths() { return changedPaths; },
      async revision() { return "a".repeat(40); },
    }),
    files: Object.freeze({
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
