/** @fileoverview Copy-only delivery of a Store's OpenSpec commands and skills to Code Repositories. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { lstatOrNull } from "../infrastructure/fs.js";
import { isContainedPath } from "../infrastructure/path.js";

/** Checks every existing path component, including parent directories. */
async function safePath(root, relative, { create = false } = {}) {
  const target = path.resolve(root, relative);
  if (!isContainedPath(root, target)) throw new Error(`AGENT_PACK_UNSAFE: ${relative}`);
  let current = root;
  for (const segment of relative.split(/[\\/]/u)) {
    current = path.join(current, segment);
    let stat = await lstatOrNull(current);
    if (!stat && create && current !== target) {
      await fs.mkdir(current).catch((error) => { if (error.code !== "EEXIST") throw error; });
      stat = await fs.lstat(current);
    }
    if (stat && (stat.isSymbolicLink() || (current !== target && !stat.isDirectory()))) {
      throw new Error(`AGENT_PACK_UNSAFE: ${current}`);
    }
  }
  return target;
}

/** A validated set of immutable upstream files; user-owned differences fail closed. */
export class AgentPackPlan {
  constructor(files, { managedEntries = [] } = {}) {
    this.files = Object.freeze(files.map((file) => Object.freeze(file)));
    this.managedEntries = Object.freeze(managedEntries.map((entry) => Object.freeze(entry)));
  }

  async check(root) {
    const { changed } = await this.inspect(root);
    if (changed.length > 0) {
      throw new Error(`AGENT_PACK_CONFLICT: ${path.resolve(root, changed[0])}; согласуйте обновление OpenSpec pack`);
    }
  }

  async install(root) {
    await this.check(root);
    const created = [];
    for (const { relative, contents } of this.files) {
      const target = await safePath(root, relative, { create: true });
      try {
        await fs.writeFile(target, contents, { flag: "wx" });
        created.push(relative);
      }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        await this.check(root);
      }
    }
    return Object.freeze(created);
  }

  /** Compares the complete managed Agent Pack without changing the target repository. */
  async inspect(root) {
    const missing = [];
    const changed = [];
    for (const { relative, contents } of this.files) {
      const target = await safePath(root, relative);
      const stat = await lstatOrNull(target);
      if (!stat) missing.push(relative);
      else if (!stat.isFile() || await fs.readFile(target, "utf8") !== contents) changed.push(relative);
    }
    const retired = [];
    for (const { directory, kind, prefix, suffix } of this.managedEntries) {
      const managedRoot = await safePath(root, directory);
      const rootStat = await lstatOrNull(managedRoot);
      if (!rootStat) continue;
      if (!rootStat.isDirectory()) throw new Error(`AGENT_PACK_UNSAFE: ${managedRoot}`);
      const directoryPrefix = `${directory}/`;
      const expected = new Set(this.files
        .map(({ relative }) => relative.startsWith(directoryPrefix)
          ? relative.slice(directoryPrefix.length).split("/")[0]
          : null)
        .filter(Boolean));
      for (const name of (await fs.readdir(managedRoot)).sort()) {
        if (!name.startsWith(prefix) || !name.endsWith(suffix) || expected.has(name)) continue;
        const relative = path.posix.join(directory, name);
        const target = await safePath(root, relative);
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) {
          throw new Error(`AGENT_PACK_UNSAFE: ${target}`);
        }
        retired.push(relative);
      }
    }
    return Object.freeze({
      missing: Object.freeze(missing.sort()),
      changed: Object.freeze(changed.sort()),
      retired: Object.freeze(retired.sort()),
    });
  }
}

/** Resolves provider paths from the distribution's Agent definition, not a concrete Agent ID. */
export class AgentPackService {
  constructor(agentProvider) { this.agents = agentProvider; }

  async plan(storeProject) {
    const agent = this.agents.resolve(storeProject.project.agent.id);
    const files = [];
    const collect = async (relative) => {
      const target = await safePath(storeProject.root, relative);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new Error(`AGENT_PACK_UNSAFE: ${target}`);
      if (stat.isDirectory()) {
        for (const name of (await fs.readdir(target)).sort()) await collect(path.join(relative, name));
      } else if (stat.isFile()) files.push({ relative: relative.split(path.sep).join("/"), contents: await fs.readFile(target, "utf8") });
      else throw new Error(`AGENT_PACK_UNSAFE: ${target}`);
    };
    const skills = path.join(agent.targetDirectory, "skills");
    for (const name of await fs.readdir(await safePath(storeProject.root, skills))) {
      if (name.startsWith("openspec-")) await collect(path.join(skills, name));
    }
    const commands = agent.commandsDirectory;
    for (const name of await fs.readdir(await safePath(storeProject.root, commands))) {
      // OpenSpec uses a dedicated opsx directory or the opsx- filename namespace.
      if (name.endsWith(".md") && (path.basename(commands) === "opsx" || name.startsWith("opsx-"))) {
        await collect(path.join(commands, name));
      }
    }
    if (files.length === 0) throw new Error("AGENT_PACK_MISSING: Store не содержит OpenSpec pack");
    const managedSkills = skills.split(path.sep).join("/");
    const managedCommands = commands.split(path.sep).join("/");
    return new AgentPackPlan(files, { managedEntries: [
      { directory: managedSkills, kind: "directory", prefix: "openspec-", suffix: "" },
      {
        directory: managedCommands,
        kind: "file",
        prefix: path.basename(commands) === "opsx" ? "" : "opsx-",
        suffix: ".md",
      },
    ] });
  }
}
