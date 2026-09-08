/** @fileoverview Возвращает canonical spec-driven-extended bootstrap при старте Claude session. */

import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const instructions = await readFile(new URL("../agent-instructions.md", import.meta.url), "utf8");
process.stdout.write(instructions);
process.stdout.write(`\nПрофиль scout этого установленного Extension: ${fileURLToPath(
  new URL("../subagents/spec-driven-extended-repository-evidence-scout.md", import.meta.url),
)}\n`);
