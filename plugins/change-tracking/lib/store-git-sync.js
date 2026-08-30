/** @fileoverview Git-native synchronization owned by the Change Tracking Plugin. */

const TRACKING_ROOT = "tracking/cycles/";

/** Coordinates one clean Store checkout with its configured origin. */
export class StoreGitSync {
  #context;

  /** @param {object} context Store-scoped public PluginContext. */
  constructor(context) {
    if (
      !context || context.repository?.role !== "store" ||
      typeof context.git?.assertNoOperation !== "function" ||
      typeof context.git?.currentBranch !== "function" ||
      typeof context.git?.statusPaths !== "function" ||
      typeof context.process?.run !== "function"
    ) {
      throw new Error("TRACKING_SYNC_INVALID: требуется Store PluginContext");
    }
    this.#context = context;
    Object.freeze(this);
  }

  /** Fast-forwards the clean Store checkout from origin before reading shared state. */
  async pull() {
    await this.#context.git.assertNoOperation();
    const changed = await this.#context.git.statusPaths();
    if (changed.length > 0) {
      throw new Error(`STORE_DIRTY: синхронизация требует чистый Store: ${changed.join(", ")}`);
    }
    const branch = await this.#context.git.currentBranch();
    if (!branch) throw new Error("TRACKING_SYNC_INVALID: Store должен быть на именованной ветке");
    await this.#context.process.run("git", ["pull", "--ff-only", "origin", branch]);
    return branch;
  }

  /** Commits only owned tracking paths and pushes the resulting Store commit by default. */
  async publish(paths, message, { noPush = false } = {}) {
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((value) => typeof value !== "string" || !value.startsWith(TRACKING_ROOT))
    ) {
      throw new Error("TRACKING_SYNC_INVALID: publish требует tracking paths");
    }
    await this.#context.process.run("git", ["add", "--", ...paths]);
    await this.#context.process.run("git", [
      "-c", "commit.gpgsign=false", "commit", "-m", message, "--", ...paths,
    ]);
    if (noPush) return Object.freeze({ committed: true, pushed: false, retried: false });
    const branch = await this.#context.git.currentBranch();
    try {
      await this.#context.process.run("git", ["push", "origin", branch]);
      return Object.freeze({ committed: true, pushed: true, retried: false });
    } catch (pushError) {
      try {
        await this.#context.process.run("git", ["fetch", "origin", branch]);
      } catch {
        throw pushError;
      }
    }
    try {
      await this.#context.process.run("git", ["rebase", "FETCH_HEAD"]);
    } catch (error) {
      try {
        await this.#context.process.run("git", ["rebase", "--abort"]);
      } catch {
        // A failed rebase can stop before creating abortable state; its conflict is authoritative.
      }
      throw new Error(
        `TRACKING_CONFLICT: не удалось совместить ${paths.join(", ")}; ` +
          "разрешите процессный конфликт и повторите команду",
        { cause: error },
      );
    }
    await this.#context.process.run("git", ["push", "origin", branch]);
    return Object.freeze({ committed: true, pushed: true, retried: true });
  }
}
