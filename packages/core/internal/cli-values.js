/** @fileoverview Общие Commander parsers внешнего CLI-контракта. */

import { InvalidArgumentError } from "commander";

/** Запрещает повтор одиночной Commander option. */
export function singleValue(value, previous) {
  if (value.startsWith("--")) throw new InvalidArgumentError("ожидается значение опции");
  if (previous !== undefined) throw new InvalidArgumentError("опцию можно указать только один раз");
  return value;
}

/** Собирает повторяемую Commander option в массив строк. */
export function collectValues(value, previous = []) {
  return [...previous, value];
}
