/** @fileoverview Shared terminal prompt presentation config. */

export const CHECKBOX_THEME = Object.freeze({
  icon: Object.freeze({ checked: "[✓]", unchecked: "[ ]" }),
});

/** Показывает заблокированный required choice выбранным, а не generic disabled-маркером. */
export const REQUIRED_CHECKBOX_THEME = Object.freeze({
  ...CHECKBOX_THEME,
  style: Object.freeze({
    disabledChoice: (text) => `[✓] ${text}`,
  }),
});
