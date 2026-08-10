/** @fileoverview Формирование проверенного агентского вызова Explore. */

const EXPLORE_ACTION = Object.freeze({
  invocation: "/opsx-explore",
  introduction: "Это Explore шага 01 SDD.",
  instructions: Object.freeze([
    "Работай только на чтение: не создавай Change, OpenSpec-артефакты, TODO, ADR, ветку или PR и не изменяй context pack, Master Specs либо код.",
    "Ticket и исходное намерение бери только из этой команды; не начинай исследование по предыдущим сообщениям сессии.",
    "Если исходного намерения недостаточно для начала исследования, задай уточняющий вопрос до чтения кода. Уточнённую проблему и ожидаемый наблюдаемый результат сформулируй по исследованным фактам.",
    "Workspace задаёт multi-repo-территорию, но не является разрешением сканировать её целиком: читай только явно перечисленные корни. Не читай родительские каталоги, remotes, невыбранные репозитории и другие соседние пути.",
    "Не обращайся к Jira API.",
    "Все непосредственные чтения specs и Changes выполняй с явным --store для указанного Store ID; не используй nearest или default Store.",
    "Прочитай openspec/context/00-start-here.md, назначенный им контекст и подходящие Master Specs; для каждого checkout проверь ветку, точную ревизию и чистоту до и после исследования.",
    "Не выдавай предполагаемые endpoint, технологии, статусы и архитектуру за текущее состояние. Каждый факт свяжи с прочитанным источником; неподтверждённое явно пометь как гипотезу или неизвестное.",
    "Верни структурированный итог: ticket, исходное намерение, уточнённая проблема, ожидаемый наблюдаемый результат, прочитанные источники, исследованные репозитории и ревизии, текущее поведение, область влияния, альтернативы, факты и источники, предположения, открытые вопросы с владельцами и признаком блокировки.",
    "Если нужен ещё один Code Repository, остановись и попроси повторить sdd explore с полным набором.",
  ]),
});

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
    `${EXPLORE_ACTION.invocation} ${result.ticket}.`,
    EXPLORE_ACTION.introduction,
    `Исходное намерение: ${JSON.stringify(intent)}.`,
    `Используй OpenSpec Store ${JSON.stringify(result.storeRepositoryId)}, Spec Root ${JSON.stringify(result.projectRoot)}, branch=${result.store.branch}, revision=${result.store.revision} и workspace ${JSON.stringify(result.workspace)}.`,
    `${repositoryScope}.`,
    `Разрешённые корни чтения: ${allowedRoots.map((value) => JSON.stringify(value)).join(", ")}.`,
    ...EXPLORE_ACTION.instructions,
    `После структурированного итога, если нет блокирующих вопросов, попроси Change Owner подтвердить завершение Explore и выбрать <short-name>; следующим действием назови только \`/sdd-change ${result.ticket} <short-name>\`. Сам команду не вызывай. Не предлагай \`/opsx-new\`, \`/opsx-propose\`, Apply или Archive.`,
  ].join(" ");
}
