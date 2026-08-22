#!/usr/bin/env node

/** @fileoverview Непубличная точка входа candidate CLI на время миграции. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { createCandidateProgram } from "../packages/core/index.js";

const templateRoot = fileURLToPath(new URL("../templates/base/", import.meta.url));

await createCandidateProgram({ templateRoot }).parseAsync(process.argv);
