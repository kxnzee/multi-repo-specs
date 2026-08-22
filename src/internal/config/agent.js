/** @fileoverview Project-config contract зарегистрированных Agent IDs. */

import * as z from "zod";

import { CONTRACT_PATTERNS } from "./constants.js";

export const AGENT_ID_SCHEMA = z.string().regex(
  CONTRACT_PATTERNS.id,
  "должен быть в lowercase kebab-case",
);

export const AGENT_IDS_SCHEMA = z.array(AGENT_ID_SCHEMA).default([]).superRefine(
  (agents, context) => {
    if (new Set(agents).size !== agents.length) {
      context.addIssue({ code: "custom", message: "agents содержит повторяющийся agent-id" });
    }
  },
);
