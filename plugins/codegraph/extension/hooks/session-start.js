/** @fileoverview Возвращает Claude canonical CodeGraph instructions при старте сессии. */

import { readFile } from "node:fs/promises";
import process from "node:process";

const instructions = await readFile(new URL("../agent-instructions.md", import.meta.url), "utf8");
process.stdout.write(instructions);
