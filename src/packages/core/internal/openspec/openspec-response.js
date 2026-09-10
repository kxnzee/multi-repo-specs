/** @fileoverview Проверка machine-readable ответов OpenSpec CLI. */

/** Проверяет базовую JSON response OpenSpec. */
export function parseOpenSpecDocument(source, command) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`OpenSpec Orchestrator не может обработать ответ ${command}: ответ не является валидным JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `OpenSpec Orchestrator не может обработать ответ ${command}: несовместимый базовый формат JSON response`,
    );
  }
  return value;
}

/** Собирает и проверяет все структурированные diagnostics OpenSpec. */
export function collectOpenSpecDiagnostics(value, command) {
  const diagnostics = [];
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "status" && Array.isArray(item)) {
        for (const diagnostic of item) {
          if (
            !diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic) ||
            !["info", "warning", "error"].includes(diagnostic.severity)
          ) {
            throw new Error(
              `OpenSpec Orchestrator не может обработать ответ ${command}: ` +
                "несовместимый формат diagnostic в status[]",
            );
          }
          diagnostics.push(diagnostic);
        }
      } else visit(item);
    }
  };
  visit(value);
  return diagnostics;
}

/** Проверяет базовую JSON response и diagnostic errors OpenSpec. */
export function parseOpenSpecJson(source, command) {
  const value = parseOpenSpecDocument(source, command);
  const errors = collectOpenSpecDiagnostics(value, command).filter(({ severity }) => severity === "error");
  if (errors.length > 0) {
    const details = errors.map(({ code, message }) => (
      `${code ? `${code}: ` : ""}${message ?? "неизвестная ошибка"}`
    )).join("; ");
    throw new Error(`${command} сообщила об ошибке: ${details}`);
  }
  return value;
}
