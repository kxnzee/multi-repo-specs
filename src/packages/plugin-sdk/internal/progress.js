/** @fileoverview Общий stderr progress renderer для Core и Plugin CLI commands. */

import process from "node:process";

const FRAMES = Object.freeze(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
const CLEAR_LINE = "\r\u001B[2K";

/** Проверяет человекочитаемое progress message. */
function message(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("CLI_PROGRESS_INVALID: message должен быть непустой строкой");
  }
  return value.trim();
}

/** Один renderer: spinner в TTY и стабильные строки в redirected stderr. */
export class CliProgressRenderer {
  #active = false;
  #frame = 0;
  #interval;
  #output;
  #text = "";
  #timer = null;

  constructor({ intervalMs = 80, output = process.stderr } = {}) {
    if (!output || typeof output.write !== "function") {
      throw new Error("CLI_PROGRESS_INVALID: output должен предоставлять write");
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("CLI_PROGRESS_INVALID: intervalMs должен быть положительным");
    }
    this.#interval = intervalMs;
    this.#output = output;
  }

  get active() {
    return this.#active;
  }

  start(value) {
    const next = message(value);
    if (this.#active) {
      this.update(next);
      return this;
    }
    this.#active = true;
    this.#text = next;
    if (!this.#output.isTTY) {
      this.#output.write(`… ${next}\n`);
      return this;
    }
    this.#render();
    this.#timer = globalThis.setInterval(() => {
      this.#frame = (this.#frame + 1) % FRAMES.length;
      this.#render();
    }, this.#interval);
    this.#timer.unref?.();
    return this;
  }

  update(value) {
    const next = message(value);
    if (!this.#active) return this.start(next);
    if (next === this.#text) return this;
    this.#text = next;
    if (this.#output.isTTY) this.#render();
    else this.#output.write(`… ${next}\n`);
    return this;
  }

  succeed(value = this.#text) {
    return this.#finish("✓", value);
  }

  fail(value = this.#text) {
    return this.#finish("✗", value);
  }

  warn(value = this.#text) {
    return this.#finish("⚠", value);
  }

  stop() {
    if (!this.#active) return this;
    this.#clearTimer();
    if (this.#output.isTTY) this.#output.write(CLEAR_LINE);
    this.#active = false;
    this.#text = "";
    return this;
  }

  async run(value, operation, { failure, success = value } = {}) {
    if (typeof operation !== "function") {
      throw new Error("CLI_PROGRESS_INVALID: operation должна быть функцией");
    }
    this.start(value);
    try {
      const result = await operation();
      this.succeed(success);
      return result;
    } catch (error) {
      this.fail(failure ?? `${message(value)}: ошибка`);
      throw error;
    }
  }

  #finish(icon, value) {
    const finalMessage = message(value);
    this.#clearTimer();
    if (this.#output.isTTY && this.#active) this.#output.write(CLEAR_LINE);
    this.#output.write(`${icon} ${finalMessage}\n`);
    this.#active = false;
    this.#text = "";
    return this;
  }

  #clearTimer() {
    if (this.#timer) globalThis.clearInterval(this.#timer);
    this.#timer = null;
  }

  #render() {
    this.#output.write(`${CLEAR_LINE}${FRAMES[this.#frame]} ${this.#text}`);
  }
}

/** Создаёт независимый renderer одной CLI composition. */
export function createCliProgress(options) {
  return new CliProgressRenderer(options);
}
