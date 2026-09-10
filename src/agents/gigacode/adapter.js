/** @fileoverview GigaCode использует совместимую с Qwen native CLI grammar. */

import { createQwenCompatibleAdapter } from "../qwen/adapter.js";

const gigacodeAdapter = createQwenCompatibleAdapter({
  scopeMarkers: Object.freeze({
    user: Object.freeze([
      "Enabled (User): true",
      "Включено (Пользователь): true",
    ]),
    workspace: Object.freeze([
      "Enabled (Workspace): true",
      "Включено (Рабочее пространство): true",
    ]),
  }),
});

export default gigacodeAdapter;
