/** @fileoverview Общие примитивы интерактивного CLI-ввода. */

/**
 * Запрашивает подтверждение на русском или английском языке.
 *
 * @param {{question: (question: string) => Promise<string>}} prompt Терминальный интерфейс.
 * @param {string} question Текст вопроса без yes/no suffix.
 * @param {(message: string) => void} [reportInvalid] Вывод ошибки формата.
 * @returns {Promise<boolean>} Решение пользователя.
 */
export async function confirm(prompt, question, reportInvalid = console.log) {
  while (true) {
    const answer = (await prompt.question(`${question} [y/N] `)).trim().toLowerCase();
    if (["y", "yes", "д", "да"].includes(answer)) return true;
    if (["", "n", "no", "н", "нет"].includes(answer)) return false;
    reportInvalid("Введите yes/да или no/нет.");
  }
}
