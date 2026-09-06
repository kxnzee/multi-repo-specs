/** @fileoverview Injects the vendored Superpowers bootstrap into Claude sessions. */

import { readFile } from "node:fs/promises";
import process from "node:process";

const bootstrap = await readFile(
  new URL("../skills/using-superpowers/SKILL.md", import.meta.url),
  "utf8",
);
const instructions = await readFile(new URL("../agent-instructions.md", import.meta.url), "utf8");
process.stdout.write(`${instructions}\n${bootstrap}`);
