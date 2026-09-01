/** @fileoverview In-memory Store context for task attempt tests. */

/** Creates the minimal mutable fake needed by AttemptTrackingService. */
export function assignmentContext({
  implementationHead = "a".repeat(40),
  implementationHeads = null,
  invocation = null,
  openSpecVersion = "1.11.0",
  planningRevision = "a".repeat(40),
  repositoryChangedPaths = [],
  schemaName = "spec-driven-extended",
  tasks = [{ id: "1", description: "1.1 Implement checkout", done: false }],
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
      async git(repositoryId) {
        if (!repositories.has(repositoryId)) throw new Error(`REPO_UNKNOWN: ${repositoryId}`);
        return Object.freeze({
          async revision() { return implementationHeads?.[repositoryId] ?? implementationHead; },
          async statusPaths() { return repositoryChangedPaths; },
        });
      },
    }),
    git: Object.freeze({
      async latestRevision() { return planningRevision; },
    }),
    process: Object.freeze({
      async run(executable, args) {
        if (executable !== "openspec") throw new Error(`unexpected executable ${executable}`);
        if (args[0] === "--version") return openSpecVersion;
        if (args[0] === "instructions" && args[1] === "apply") {
          return JSON.stringify({
            changeName: args[args.indexOf("--change") + 1],
            schemaName,
            tasks,
          });
        }
        throw new Error(`unexpected openspec args ${args.join(" ")}`);
      },
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
