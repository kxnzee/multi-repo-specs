/** @fileoverview Installs the exact publishable tarballs in a blank consumer project. */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const distributionManifest = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const distributionVersion = distributionManifest.version;
const npmCli = process.env.npm_execpath;
if (typeof npmCli !== "string" || !path.isAbsolute(npmCli)) {
  throw new Error("PACKED_SMOKE_NPM_UNAVAILABLE: запустите через npm run test:pack");
}

/** Invokes the current npm CLI through Node without platform-specific shell wrappers. */
function runNpm(args, options) {
  return execFileSync(process.execPath, [npmCli, ...args], { timeout: 120000, ...options });
}

/** Resolves every publishable workspace from the root npm workspace declarations. */
async function publishableRoots() {
  const roots = ["."];
  for (const pattern of distributionManifest.workspaces) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`PACKED_SMOKE_WORKSPACE_PATTERN_UNSUPPORTED: ${pattern}`);
    }
    const parent = pattern.slice(0, -2);
    const entries = await fs.readdir(path.join(root, parent), { withFileTypes: true });
    roots.push(...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name)));
  }
  const publishable = [];
  for (const packageRoot of roots) {
    const manifestPath = path.join(root, packageRoot, "package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest.private !== true) publishable.push({ manifest, packageRoot });
  }
  return publishable.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

const packages = await publishableRoots();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-packed-smoke-"));
const artifacts = path.join(temporary, "artifacts");
const consumer = path.join(temporary, "consumer");
const npmEnvironment = {
  ...process.env,
  NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
};

try {
  await fs.mkdir(artifacts);
  await fs.mkdir(consumer);
  const dependencies = {};
  const imports = [];
  for (const { manifest, packageRoot } of packages) {
    const absoluteRoot = path.resolve(root, packageRoot);
    const output = runNpm(
      ["pack", absoluteRoot, "--json", "--pack-destination", artifacts],
      { cwd: root, encoding: "utf8", env: npmEnvironment },
    );
    const [{ filename }] = JSON.parse(output);
    dependencies[manifest.name] = `file:${path.join(artifacts, filename)}`;
    if (manifest.exports) {
      const exportPaths = typeof manifest.exports === "string"
        ? ["."]
        : Object.entries(manifest.exports)
          .filter(([exportPath, target]) => (
            typeof target === "string" && target.endsWith(".js") &&
            !exportPath.startsWith("./bin/")
          ))
          .map(([exportPath]) => exportPath);
      imports.push(...exportPaths.map((exportPath) => (
        exportPath === "." ? manifest.name : `${manifest.name}${exportPath.slice(1)}`
      )));
    }
  }
  await fs.writeFile(path.join(consumer, "package.json"), `${JSON.stringify({
    name: "openspec-orchestrator-packed-consumer",
    private: true,
    type: "module",
    dependencies,
  }, null, 2)}\n`);
  runNpm([
    "install",
    "--ignore-scripts",
    "--install-links",
    "--no-audit",
    "--no-fund",
  ], { cwd: consumer, env: npmEnvironment, stdio: "inherit" });
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    imports.map((specifier) => `import ${JSON.stringify(specifier)};`).join("\n"),
  ], { cwd: consumer, stdio: "inherit", timeout: 30000 });
  const version = execFileSync(
    process.execPath,
    [path.join(consumer, "node_modules/openspec-orchestrator/bin/openspec-orch.js"), "--version"],
    { cwd: consumer, encoding: "utf8", timeout: 30000 },
  ).trim();
  if (version !== distributionVersion) {
    throw new Error(`PACKED_SMOKE_VERSION_INVALID: ${version}; expected ${distributionVersion}`);
  }
  execFileSync(process.execPath, [
    "--test", "--test-concurrency=1", "--test-timeout=180000",
    path.join(root, "test/distribution-plugin-cli.test.js"),
  ], {
    cwd: consumer,
    env: {
      ...process.env,
      OPENSPEC_ORCH_TEST_CLI_PATH: path.join(consumer, "node_modules/openspec-orchestrator/bin/openspec-orch.js"),
      OPENSPEC_ORCH_TEST_MCP_PATH: path.join(consumer, "node_modules/openspec-orchestrator/bin/openspec-orch-mcp.js"),
    },
    stdio: "inherit",
    timeout: 300000,
  });
  console.log(`Packed artifact smoke passed for ${packages.length} packages, including CLI/MCP first-run scenarios.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
