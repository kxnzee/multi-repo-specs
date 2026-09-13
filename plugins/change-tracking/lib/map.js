/** @fileoverview Атомарное сохранение одной реализации с проверкой устаревшего курсора. */
import { setTimeout as delay } from "node:timers/promises";
import { parse, stringify } from "yaml";
import { checkedRecord, fingerprint, identifier, MAP_FILE, recordKey, shape } from "./records.js";

export class ImplementationMap {
  constructor(files) { this.files = files; }

  path(changeId) {
    if (!identifier(changeId)) throw new Error("TRACKING_INPUT_INVALID: некорректный change_id");
    return `openspec/changes/${changeId}/${MAP_FILE}`;
  }

  parse(changeId, source) {
    if (source === null) return { contract_version: 1, change_id: changeId, implementations: [] };
    let value;
    try { value = parse(source); } catch { throw new Error("TRACKING_MAP_INVALID: некорректный YAML"); }
    if (!shape(value, ["contract_version", "change_id", "implementations"]) ||
      value.contract_version !== 1 || value.change_id !== changeId || !Array.isArray(value.implementations)) {
      throw new Error("TRACKING_MAP_INVALID: несовместимый формат; автоматическое преобразование не выполняется");
    }
    const implementations = value.implementations.map(checkedRecord);
    if (new Set(implementations.map(recordKey)).size !== implementations.length) {
      throw new Error("TRACKING_MAP_INVALID: несколько текущих реализаций одной задачи в Repository");
    }
    return { contract_version: 1, change_id: changeId, implementations };
  }

  async read(changeId) {
    return this.parse(changeId, await this.files.read(this.path(changeId), { optional: true }));
  }

  async save(changeId, value, observed) {
    const entry = checkedRecord(value);
    let changed;
    for (let retry = 0; ; retry += 1) {
      try {
        await this.files.update(this.path(changeId), (source) => {
          const document = this.parse(changeId, source);
          const existing = document.implementations.find((item) => recordKey(item) === recordKey(entry));
          if (existing && fingerprint(existing) === fingerprint(entry)) { changed = false; return source; }
          if ((existing ? fingerprint(existing) : null) !== observed) {
            throw new Error("TRACKING_CONFLICT: запись обновлена другим исполнителем; отмените локальную работу и перечитайте status");
          }
          const entries = document.implementations.filter((item) => recordKey(item) !== recordKey(entry));
          entries.push(entry);
          entries.sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
          changed = true;
          return stringify({ ...document, implementations: entries });
        });
        return { changed, path: this.path(changeId), implementation: entry };
      } catch (error) {
        if (error.code !== "FILE_UPDATE_BUSY" || retry >= 19) throw error;
        await delay(10);
      }
    }
  }
}
