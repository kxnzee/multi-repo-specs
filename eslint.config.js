/** @fileoverview ESLint flat config для production-кода и тестов OpenSpec Orchestrator. */

import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";

export default [
  {
    ignores: ["coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        URL: "readonly",
      },
    },
    plugins: {
      jsdoc,
    },
    rules: {
      "jsdoc/require-jsdoc": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-types": "error",
      "no-unused-vars": "error",
      eqeqeq: "error",
      "no-unreachable": "error",
    },
  },
  {
    files: ["plugins/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/packages/core/**", "**/src/internal/**", "@openspec-orch/core", "@openspec-orch/core/**"],
          message: "Plugin должен использовать только публичный Plugin SDK и Core facades.",
        }],
      }],
    },
  },
  {
    files: ["packages/core/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/plugins/**", "@openspec-orch/plugin-*", "@openspec-orch/plugin-*/**"],
          message: "Core не должен импортировать конкретные Plugins.",
        }],
      }],
    },
  },
  {
    files: ["packages/plugin-sdk/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "**/packages/core/**",
            "**/plugins/**",
            "**/src/internal/**",
            "**/core/**",
            "@openspec-orch/core",
            "@openspec-orch/core/**",
            "@openspec-orch/plugin-*",
            "@openspec-orch/plugin-*/**",
          ],
          message: "Plugin SDK должен оставаться независимым от Core internals и конкретных Plugins.",
        }],
      }],
    },
  },
];
