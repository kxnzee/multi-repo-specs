/** @fileoverview Внешний контракт Plugin descriptor. */

import * as z from "zod";

import { CONTRACT_PATTERNS } from "../config/constants.js";
import { PLUGIN_ID_SCHEMA } from "../config/plugin.js";
import {
  PLUGIN_DESCRIPTOR_FILE,
  PLUGIN_PACKAGE_API_VERSION,
} from "./constants.js";

const ARGUMENTS_SCHEMA = z.array(z.string());
const PORTABLE_PACKAGE_PATH_SCHEMA = z.string().min(1).refine(
  (value) => !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
  "должен быть безопасным относительным POSIX path",
);
const PLUGIN_DESCRIPTOR_SCHEMA = z.strictObject({
  id: PLUGIN_ID_SCHEMA,
  name: z.string().min(1),
  version: z.string().regex(CONTRACT_PATTERNS.exactSemanticVersion, "должна быть semantic version"),
  type: z.literal("cli"),
  command: z.string().regex(
    CONTRACT_PATTERNS.executableName,
    "должна быть безопасным именем executable",
  ),
  args: ARGUMENTS_SCHEMA.default([]),
  supports: z.array(z.enum(["store", "code"])).min(1),
  lifecycle: z.strictObject({
    connect: ARGUMENTS_SCHEMA,
    status: ARGUMENTS_SCHEMA,
    sync: ARGUMENTS_SCHEMA.optional(),
  }),
  agent: z.strictObject({
    install: ARGUMENTS_SCHEMA,
    remove: ARGUMENTS_SCHEMA,
  }).optional(),
}).superRefine((descriptor, context) => {
  if (new Set(descriptor.supports).size !== descriptor.supports.length) {
    context.addIssue({ code: "custom", message: "supports содержит повторяющуюся роль" });
  }
});

/** Проверяет `plugin.yaml`, необходимый для discovery и CLI routing. */
export function parsePluginDescriptor(value, label) {
  const result = PLUGIN_DESCRIPTOR_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(`PLUGIN_INVALID: ${label}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

const PLUGIN_PACKAGE_SCHEMA = z.strictObject({
  name: z.string().min(1),
  version: z.string().regex(CONTRACT_PATTERNS.exactSemanticVersion, "должна быть exact semantic version"),
  openspecOrchestrator: z.strictObject({
    apiVersion: z.literal(PLUGIN_PACKAGE_API_VERSION),
    manifest: z.literal(PLUGIN_DESCRIPTOR_FILE),
    entrypoint: PORTABLE_PACKAGE_PATH_SCHEMA.optional(),
  }),
  dependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
}).passthrough();

/** Проверяет package metadata, отделённые от доменного Plugin descriptor. */
export function parsePluginPackageManifest(value, label) {
  const result = PLUGIN_PACKAGE_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(`PLUGIN_PACKAGE_INVALID: ${label}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

const PLUGIN_INSTALLATION_SCHEMA = z.discriminatedUnion("kind", [
  z.strictObject({
    apiVersion: z.literal(PLUGIN_PACKAGE_API_VERSION),
    kind: z.literal("bundled"),
    packageName: z.string().min(1),
  }),
  z.strictObject({
    apiVersion: z.literal(PLUGIN_PACKAGE_API_VERSION),
    kind: z.literal("local"),
  }),
]);

/** Проверяет Store-local ссылку на способ поставки Plugin Package. */
export function parsePluginInstallation(value, label) {
  const result = PLUGIN_INSTALLATION_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(`PLUGIN_INSTALLATION_INVALID: ${label}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
