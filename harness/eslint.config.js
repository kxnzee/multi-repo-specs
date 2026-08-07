/** @fileoverview ESLint flat config для production-кода и тестов Harness. */

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
];
