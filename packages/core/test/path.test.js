/** @fileoverview Direct boundary tests for safe canonical and portable paths. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { isContainedPath, isPortableRelativePath } from "../internal/path.js";

test("isContainedPath rejects prefix siblings and parent traversal", () => {
  const root = path.resolve("workspace/project");

  assert.equal(isContainedPath(root, path.join(root, "src/index.js")), true);
  assert.equal(isContainedPath(root, root), false);
  assert.equal(isContainedPath(root, root, { allowRoot: true }), true);
  assert.equal(isContainedPath(root, `${root}-evil/file.js`), false);
  assert.equal(isContainedPath(root, path.resolve(root, "../outside.js")), false);
});

test("isPortableRelativePath accepts normalized POSIX paths only", () => {
  for (const value of ["src/index.js", "single", "."]) {
    assert.equal(isPortableRelativePath(value), true, value);
  }
  for (const value of ["", "/absolute", "../outside", "src/../outside", "src//file", "C:/file", "src\\file", "file\0name"]) {
    assert.equal(isPortableRelativePath(value), false, value);
  }
  assert.equal(isPortableRelativePath(".", { allowDot: false }), false);
});
