#!/usr/bin/env node

/** @fileoverview Непубличная точка входа candidate CLI на время миграции. */

import process from "node:process";

import { createCandidateProgram } from "../packages/core/index.js";

await createCandidateProgram().parseAsync(process.argv);
