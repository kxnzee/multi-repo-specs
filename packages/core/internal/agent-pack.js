/** @fileoverview Copy-only delivery of a Store's OpenSpec commands and skills to Code Repositories. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { lstatOrNull } from "./fs.js";
import { isContainedPath } from "./path.js";

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
  constructor(files) { this.files = Object.freeze(files.map((file) => Object.freeze(file))); }

  async check(root) {
    for (const { relative, contents } of this.files) {
      const target = await safePath(root, relative);
      const stat = await lstatOrNull(target);
      if (stat && (!stat.isFile() || await fs.readFile(target, "utf8") !== contents)) {
        throw new Error(`AGENT_PACK_CONFLICT: ${target}; согласуйте обновление OpenSpec pack`);
      }
    }
  }

  async install(root) {
    await this.check(root);
    for (const { relative, contents } of this.files) {
      const target = await safePath(root, relative, { create: true });
      try { await fs.writeFile(target, contents, { flag: "wx" }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        await this.check(root);
      }
    }
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
    return new AgentPackPlan(files);
  }
}
