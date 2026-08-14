/** @fileoverview Единый низкоуровневый контракт с установленным Git CLI. */

import path from "node:path";

/**
 * Разбирает пути из `git status --porcelain=v1 -z`.
 *
 * @param {string} output Машинный вывод Git.
 * @returns {string[]} Все затронутые пути, включая исходный путь rename/copy.
 */
function parseStatusPaths(output) {
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git вернул некорректный porcelain status");
    }
    const state = record.slice(0, 2);
    paths.push(record.slice(3));
    if (/[RC]/.test(state)) {
      index += 1;
      if (!records[index]) throw new Error("Git вернул неполный rename/copy status");
      paths.push(records[index]);
    }
  }
  return paths;
}

/**
 * Разбирает множество непустых строк из построчного вывода Git.
 *
 * @param {string} output Машинный вывод Git.
 * @returns {Set<string>} Уникальные значения.
 */
function parseLineSet(output) {
  return new Set(output.split(/\r?\n/).filter(Boolean));
}

/**
 * Разбирает зарегистрированные пути из porcelain-вывода `git worktree list`.
 *
 * @param {string} output Машинный вывод Git.
 * @returns {Set<string>} Абсолютные пути worktree.
 */
function parseWorktreePaths(output) {
  return new Set(
    output.split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => path.resolve(line.slice("worktree ".length))),
  );
}

/**
 * Привязывает все Git-операции к одному рабочему каталогу и command runner.
 */
class GitClient {
  /** @type {string} */
  #cwd;

  /** @type {typeof import("./command.js").runCommand} */
  #commandRunner;

  /**
   * @param {string} cwd Рабочий каталог Git.
   * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель внешних команд.
   */
  constructor(cwd, commandRunner) {
    this.#cwd = cwd;
    this.#commandRunner = commandRunner;
  }

  /**
   * Выполняет одну Git-команду без shell.
   *
   * @param {string[]} args Аргументы Git.
   * @param {object} [options] Дополнительные параметры command runner.
   * @param {string[]} [options.sensitiveValues] Значения для скрытия в диагностике.
   * @returns {Promise<string>} Стандартный вывод Git.
   */
  #run(args, options = {}) {
    return this.#commandRunner("git", args, { cwd: this.#cwd, ...options });
  }

  /** @returns {Promise<string>} Абсолютный корень текущего checkout. */
  async repositoryRoot() {
    return path.resolve(await this.#run(["rev-parse", "--show-toplevel"]));
  }

  /** @returns {Promise<string>} URL remote `origin`. */
  originUrl() {
    return this.#run(["remote", "get-url", "origin"]);
  }

  /** @returns {Promise<string>} Текущая ветка или пустая строка для detached HEAD. */
  currentBranch() {
    return this.#run(["branch", "--show-current"]);
  }

  /**
   * Возвращает изменённые пути в безопасном NUL-separated формате.
   *
   * @param {string[]} [pathspec] Необязательное ограничение путей.
   * @returns {Promise<string[]>} Изменённые пути.
   */
  async statusPaths(pathspec = []) {
    const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
    if (pathspec.length > 0) args.push("--", ...pathspec);
    return parseStatusPaths(await this.#run(args));
  }

  /**
   * Проверяет отсутствие изменений во всём checkout или выбранных путях.
   *
   * @param {string[]} [pathspec] Необязательное ограничение путей.
   * @returns {Promise<boolean>} `true`, если изменений нет.
   */
  async isClean(pathspec = []) {
    return (await this.statusPaths(pathspec)).length === 0;
  }

  /**
   * Разрешает Git ref в ревизию или другое значение `rev-parse`.
   *
   * @param {string} [ref] Git ref.
   * @returns {Promise<string>} Результат `rev-parse`.
   */
  revision(ref = "HEAD") {
    return this.#run(["rev-parse", ref]);
  }

  /**
   * Возвращает служебный путь текущего Git checkout.
   *
   * @param {string} marker Имя служебного файла или каталога.
   * @returns {Promise<string>} Путь, возвращённый Git.
   */
  gitPath(marker) {
    return this.#run(["rev-parse", "--git-path", marker]);
  }

  /**
   * Проверяет наличие ветки в `origin`, не изменяя локальные refs.
   *
   * @param {string} branch Имя ветки.
   * @returns {Promise<boolean>} Признак опубликованной ветки.
   */
  async hasRemoteBranch(branch) {
    return Boolean(await this.#run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
  }

  /**
   * Проверяет наличие локальной ветки.
   *
   * @param {string} branch Имя ветки.
   * @returns {Promise<boolean>} Признак локальной ветки.
   */
  async hasLocalBranch(branch) {
    return Boolean(await this.#run(["branch", "--list", branch, "--format=%(refname:short)"]));
  }

  /**
   * Загружает все refs из `origin` без тегов.
   *
   * @returns {Promise<void>}
   */
  async fetchOrigin() {
    await this.#run(["fetch", "--no-tags", "origin"]);
  }

  /**
   * Загружает одну ветку `origin` в точный remote-tracking ref.
   *
   * @param {string} branch Имя ветки.
   * @returns {Promise<void>}
   */
  async fetchRemoteBranch(branch) {
    const source = `refs/heads/${branch}`;
    const target = `refs/remotes/origin/${branch}`;
    await this.#run(["fetch", "origin", `+${source}:${target}`]);
  }

  /**
   * Клонирует одну ветку без тегов.
   *
   * @param {object} options Параметры clone.
   * @param {string} options.url Git URL.
   * @param {string} options.target Целевой каталог.
   * @param {string} options.branch Ветка.
   * @returns {Promise<void>}
   */
  async cloneBranch({ url, target, branch }) {
    await this.#run(
      ["clone", "--single-branch", "--no-tags", "--branch", branch, "--", url, target],
      { sensitiveValues: [url] },
    );
  }

  /**
   * Создаёт и выбирает новую ветку.
   *
   * @param {string} branch Новая ветка.
   * @param {object} [options] Параметры ветвления.
   * @param {string} [options.startPoint] Начальный ref.
   * @param {boolean} [options.track] Настроить upstream от начального ref.
   * @returns {Promise<void>}
   */
  async createBranch(branch, { startPoint, track = false } = {}) {
    const args = ["switch"];
    if (track) args.push("--track");
    else if (startPoint) args.push("--no-track");
    args.push("-c", branch);
    if (startPoint) args.push(startPoint);
    await this.#run(args);
  }

  /**
   * Читает файл из указанной ревизии.
   *
   * @param {string} revision Git revision.
   * @param {string} filePath Путь внутри репозитория.
   * @returns {Promise<string>} Содержимое файла.
   */
  showFile(revision, filePath) {
    return this.#run(["show", `${revision}:${filePath}`]);
  }

  /**
   * Считает commit в диапазоне.
   *
   * @param {string} range Git revision range.
   * @returns {Promise<number>} Неотрицательное число commit.
   */
  async countCommits(range) {
    const count = Number(await this.#run(["rev-list", "--count", range]));
    if (!Number.isInteger(count) || count < 0) throw new Error("Git вернул некорректное число commit");
    return count;
  }

  /**
   * Возвращает локальные и remote refs выбранных пространств имён.
   *
   * @param {string[]} namespaces Полные префиксы refs.
   * @returns {Promise<Set<string>>} Имена refs.
   */
  async refs(namespaces) {
    return parseLineSet(await this.#run(["for-each-ref", "--format=%(refname)", ...namespaces]));
  }

  /**
   * Возвращает upstream локальной ветки.
   *
   * @param {string} branch Локальная ветка.
   * @returns {Promise<string>} Короткое имя upstream или пустая строка.
   */
  branchUpstream(branch) {
    return this.#run(["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`]);
  }

  /**
   * Вычисляет расхождение двух refs.
   *
   * @param {string} local Локальный ref.
   * @param {string} remote Remote ref.
   * @returns {Promise<{localOnly: number, remoteOnly: number}>} Число уникальных commit с каждой стороны.
   */
  async divergence(local, remote) {
    const values = (await this.#run(["rev-list", "--left-right", "--count", `${local}...${remote}`]))
      .trim()
      .split(/\s+/)
      .map(Number);
    if (values.length !== 2 || values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error("Git вернул некорректный статус upstream");
    }
    return { localOnly: values[0], remoteOnly: values[1] };
  }

  /**
   * Находит общего предка двух refs.
   *
   * @param {string} left Первый ref.
   * @param {string} right Второй ref.
   * @returns {Promise<string>} Merge-base revision.
   */
  mergeBase(left, right) {
    return this.#run(["merge-base", left, right]);
  }

  /** @returns {Promise<Set<string>>} Зарегистрированные абсолютные пути worktree. */
  async worktreePaths() {
    return parseWorktreePaths(await this.#run(["worktree", "list", "--porcelain"]));
  }

  /**
   * Принудительно удаляет зарегистрированный worktree.
   *
   * @param {string} worktreeRoot Путь worktree.
   * @returns {Promise<void>}
   */
  async removeWorktree(worktreeRoot) {
    await this.#run(["worktree", "remove", "--force", worktreeRoot]);
  }

  /**
   * Создаёт detached worktree на точной ревизии.
   *
   * @param {string} worktreeRoot Путь worktree.
   * @param {string} revision Git revision.
   * @returns {Promise<void>}
   */
  async addDetachedWorktree(worktreeRoot, revision) {
    await this.#run(["worktree", "add", "--detach", worktreeRoot, revision]);
  }

  /**
   * Читает строковое значение локальной Git-настройки.
   *
   * @param {string} key Ключ Git config.
   * @param {string} [defaultValue] Значение при отсутствии ключа.
   * @returns {Promise<string>} Значение настройки.
   */
  configValue(key, defaultValue = "") {
    return this.#run(["config", "--local", "--get", "--default", defaultValue, key]);
  }

  /**
   * Записывает одно строковое значение локальной Git-настройки.
   *
   * @param {string} key Ключ Git config.
   * @param {string} value Значение.
   * @returns {Promise<void>}
   */
  async setConfigValue(key, value) {
    await this.#run(["config", "--local", "--replace-all", key, value]);
  }
}

/**
 * Создаёт Git client для одного рабочего каталога.
 *
 * @param {string} cwd Рабочий каталог Git.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель внешних команд.
 * @returns {GitClient} Привязанный Git client.
 */
export function createGitClient(cwd, commandRunner) {
  return new GitClient(cwd, commandRunner);
}
