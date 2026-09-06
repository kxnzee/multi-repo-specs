/** @fileoverview Публичный контракт декларативных Agent Extensions. */

export {
  EXTENSION_API_VERSION,
  EXTENSION_ID_PATTERN,
  ExtensionDescriptor,
  ExtensionPackage,
} from "./internal/package.js";
export { Extension, defineExtension } from "./internal/extension.js";
