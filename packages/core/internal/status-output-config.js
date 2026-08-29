/** @fileoverview Human-readable presentation config for machine states. */

export const STATUS_PRESENTATIONS = Object.freeze({
  blocked: Object.freeze({ icon: "✗", label: "заблокирован" }),
  complete: Object.freeze({ icon: "✓", label: "готов" }),
  completed: Object.freeze({ icon: "✓", label: "завершён" }),
  connected: Object.freeze({ icon: "✓", label: "подключён" }),
  diverged: Object.freeze({ icon: "⚠", label: "параметры не совпадают" }),
  fail: Object.freeze({ icon: "✗", label: "проверка не пройдена" }),
  failed: Object.freeze({ icon: "✗", label: "ошибка" }),
  invalid: Object.freeze({ icon: "✗", label: "некорректное состояние" }),
  missing: Object.freeze({ icon: "✗", label: "checkout отсутствует" }),
  needs_setup_pr: Object.freeze({ icon: "⚠", label: "требуется setup PR" }),
  not_a_directory: Object.freeze({ icon: "✗", label: "путь не является каталогом" }),
  not_a_git_repository: Object.freeze({ icon: "✗", label: "не Git repository" }),
  not_a_git_root: Object.freeze({ icon: "✗", label: "путь не является корнем Git" }),
  pass: Object.freeze({ icon: "✓", label: "проверка пройдена" }),
  ready: Object.freeze({ icon: "✓", label: "готов" }),
  stale: Object.freeze({ icon: "⚠", label: "требует обновления" }),
  unavailable: Object.freeze({ icon: "✗", label: "недоступен" }),
  workspace_unresolved: Object.freeze({ icon: "✗", label: "workspace не определён" }),
});
