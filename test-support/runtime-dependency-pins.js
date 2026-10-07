/** @fileoverview Checks required runtime pins using package-relative npm lockfile resolution. */

import assert from "node:assert/strict";
import path from "node:path";

/** Finds the nearest dependency entry, following a workspace link to its real location. */
function resolveLockedDependency(lock, fromLocation, name) {
  let directory = fromLocation;
  while (true) {
    if (path.posix.basename(directory) !== "node_modules") {
      const candidate = path.posix.join(directory, "node_modules", name);
      const entry = lock.packages[candidate];
      if (entry) {
        const location = entry.link ? entry.resolved : candidate;
        const resolved = lock.packages[location];
        assert.ok(resolved && typeof resolved.version === "string", `Missing versioned lock entry for ${candidate}`);
        return { name, location, entry: resolved };
      }
    }
    if (directory === "." || directory === "") break;
    const parent = path.posix.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  assert.fail(`Missing lock entry for ${name} from ${fromLocation}`);
}

/** Walks each package location separately so nested versions and cycles are handled correctly. */
export function lockedDependencyClosure(lock, packageLocation, rootName) {
  const pending = [resolveLockedDependency(lock, packageLocation, rootName)];
  const visited = new Set();
  const dependencies = [];
  while (pending.length > 0) {
    const dependency = pending.pop();
    if (visited.has(dependency.location)) continue;
    visited.add(dependency.location);
    dependencies.push(dependency);
    for (const name of Object.keys(dependency.entry.dependencies ?? {})) {
      pending.push(resolveLockedDependency(lock, dependency.location, name));
    }
  }
  return dependencies;
}

/** Requires the selected root version and every external runtime dependency to match direct pins. */
export function assertRuntimeDependencyPins(manifest, lock, packageLocation, rootName) {
  const dependencies = lockedDependencyClosure(lock, packageLocation, rootName);
  assert.equal(
    manifest.dependencies[rootName],
    dependencies[0].entry.version,
    `Core must pin ${rootName} resolved from ${packageLocation}`,
  );
  for (const { name, location, entry } of dependencies) {
    if (name.startsWith("@inquirer/")) continue;
    assert.equal(
      manifest.dependencies[name],
      entry.version,
      `Core must pin the external Inquirer runtime dependency ${name}@${entry.version} (${location})`,
    );
  }
}
