/** @fileoverview Формирование проверенного агентского вызова Explore. */

const EXPLORE_INVOCATION = "/opsx-explore";

/**
 * Нормализует обязательный текст агентского вызова.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {string} label Название значения.
 * @returns {string} Непустой текст.
 */
function requireExploreText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Для Explore требуется ${label}`);
  return value.trim();
}

/**
 * Собирает готовую команду `/opsx-explore`.
 *
 * @param {object} result Проверенная область и намерение запроса.
 * @returns {string} Полная slash-команда.
 */
export function buildExploreInvocation(result) {
  const intent = requireExploreText(result.intent, "намерение запроса");
  const repositoryScope = result.projectSpecsOnly
    ? `Code Repositories не выбраны: исследуй только ${result.storeRepositoryId}`
    : `Code Repositories: ${result.repositories
        .map(({ id, branch, revision, path: repositoryPath }) => `${id}, branch=${branch}, revision=${revision}, path=${JSON.stringify(repositoryPath)}`)
        .join("; ")}`;
  const allowedRoots = [result.projectRoot, ...result.repositories.map(({ path: value }) => value)];
  return [
    `${EXPLORE_INVOCATION} ${result.ticket}.`,
    `Перед исследованием прочитай и выполни проектный контракт ${JSON.stringify(result.exploreInstructionsPath)}.`,
    `Исходное намерение: ${JSON.stringify(intent)}.`,
    `Execution mode: ${result.executionMode}.`,
    `Используй OpenSpec Store ${JSON.stringify(result.storeRepositoryId)}, Spec Root ${JSON.stringify(result.projectRoot)}, branch=${result.store.branch}, revision=${result.store.revision} и workspace ${JSON.stringify(result.workspace)}.`,
    `${repositoryScope}.`,
    `Разрешённые корни чтения: ${allowedRoots.map((value) => JSON.stringify(value)).join(", ")}.`,
  ].join(" ");
}
