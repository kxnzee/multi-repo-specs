/** @fileoverview Минимальные contract assertions для Extension packages. */

import { ExtensionDescriptor, ExtensionPackage } from "./index.js";
import test from "node:test";

/** Проверяет package manifest и descriptor одной Extension. */
export function assertExtensionContract({ agentIds, descriptor, packageManifest }) {
  const extensionPackage = new ExtensionPackage(packageManifest);
  const extensionDescriptor = new ExtensionDescriptor(descriptor, { agentIds });
  return Object.freeze({
    id: extensionDescriptor.id,
    name: extensionDescriptor.name,
    package: extensionPackage.identity(),
  });
}

/** Регистрирует стандартный Node test для standalone Extension package. */
export function testExtensionContract(options) {
  test(`${options.descriptor.id} satisfies Extension SDK contract`, () => {
    assertExtensionContract(options);
  });
}
