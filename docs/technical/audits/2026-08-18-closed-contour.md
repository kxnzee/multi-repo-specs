# Аудит документации и тестов перед переносом в закрытый контур

Дата: 2026-08-18
Ревизия: `b84fb16` (`pilot-refactor-orch`)
Режим: аудит с отдельно согласованными исправлениями корневого README и Node.js
baseline; остальные findings не исправлялись.

## Итог

Core и основная тестовая база находятся в рабочем состоянии, но текущий checkout
нельзя считать полностью подготовленным к воспроизводимому переносу в закрытый
контур. Node.js baseline приведён к требованию OpenSpec. До переноса остаётся заменить
внешние Git/npm-зависимости на доступные внутри контура источники и проверить
собранный комплект на чистой целевой машине.

## Выполненные проверки

- `npm run check`: успешно, 153/153 теста, lint без ошибок;
- после исправления Node.js baseline полный `npm run check` повторён на Node.js
  `22.23.2`: успешно, 153/153;
- `npm run test:coverage`: успешно; строки 93.01%, ветви 89.58%, функции 92.47%;
- `npm pack --dry-run`: успешно, 88 файлов, package size 78.9 kB;
- локальные Markdown-ссылки: 11 отсутствующих целей в
  `docs/openspec-origin-docs/`;
- реальный OpenSpec CLI `1.7.0`: `store list --json`, `store doctor specs --json` и
  `context --store specs --json` успешно отработали read-only;
- `openspec-orch repository status` успешно прочитал текущее состояние pilot
  workspace без сетевых и исправляющих операций.

## Findings

### Исправлено. Несогласованный Node.js baseline

До исправления `package.json` и корневой README допускали Node.js `20.5+`, а
рекомендуемый в проектной документации OpenSpec `1.7.0` объявляет engine
`>=20.19.0`. Первичный аудит был выполнен на Node.js `20.13.1`: тесты проходили и CLI
запускался, хотя связка находилась ниже официальной границы OpenSpec.

Исправлено: минимальная версия `20.19.0` синхронизирована в package metadata и
README, binary явно отклоняет Node.js `20.18.0`, а regression test проверяет отказ
ниже границы и допуск точной версии `20.19.0`. Полный suite выполнен на доступной
поддерживаемой Node.js `22.23.2`. Реальный изолированный OpenSpec smoke остаётся
отдельным P1 finding.

### P0. Текущий pilot workspace использует внешние Git remotes

Store metadata, `openspec-orch.yaml` и `origin` Store/Code Repositories указывают на
`github.com/kxnzee/*`. В strict mode Orchestrator сверяет эти значения, поэтому
простая замена только одного из источников приведёт к отказу identity-check.

Риск: `connect`, `repository status` или последующие операции не смогут подтвердить
репозитории после переноса; отсутствующие checkout нельзя будет клонировать без
доступа к GitHub.

Нужно подготовить внутренние Git remotes и согласованно перенести Store metadata,
`openspec-orch.yaml` и локальные `origin`. После переноса выполнить read-only
`openspec store doctor`, `openspec context` и `openspec-orch repository status`.

### P1. Нет инструкции и проверяемого комплекта для offline/internal install

README и pilot runbook используют `npm install`; `package-lock.json` содержит URL
`registry.npmjs.org`. В проекте нет инструкции для внутреннего registry или
подготовленного offline cache, точного перечня переносимых runtime-компонентов,
checksum и процедуры проверки артефакта. В vendored upstream-документации также
используется `@latest`.

Риск: исходники переносятся, но зависимости Orchestrator, OpenSpec CLI или agent
runtime нельзя воспроизводимо установить внутри контура.

Нужно описать один поддерживаемый маршрут поставки: source checkout + `npm ci` через
внутренний registry/offline cache либо проверенный package artifact. Комплект должен
фиксировать commit Orchestrator, Node/npm, OpenSpec, agent runtime, lockfile,
checksums и внутренние Git/npm endpoints.

### P1. Автотесты не запускают реальный OpenSpec CLI

Интеграционные сценарии `init` и `connect` используют `fakeOpenSpec`: они хорошо
проверяют ожидаемые команды и JSON-контракт, но не доказывают, что точная версия
OpenSpec создаёт ожидаемый agent pack и возвращает совместимые ответы. Выполненная в
аудите read-only проверка подтверждает только три JSON-capability и не заменяет
изолированный `init -> connect` smoke.

Нужно добавить отдельный opt-in compatibility smoke с точной версией OpenSpec,
изолированными `XDG_CONFIG_HOME`/Store registry и локальными Git remotes. Он должен
быть безопасен для рабочего registry и пригоден для запуска уже внутри целевого
контура.

### P1. Корневой README не полностью совпадает с публичной CLI-грамматикой

В разделе «Публичный CLI» не указаны `status --json` и общий для `init`/`connect`
флаг `--no-strict`, хотя они объявлены в `src/cli/program.js` и проверяются в
`test/cli.test.js`. Сейчас тесты автоматически сверяют с Template только список
поддерживаемых агентов, но не полный CLI-раздел README.

Нужно актуализировать список и добавить docs-contract test, который обнаруживает
дрейф команд и публичных опций относительно Commander help.

### P1. Vendored OpenSpec reference неполон и не имеет provenance

`docs/openspec-origin-docs/` обозначен как upstream-справочник, но не указывает
точную исходную версию/commit и дату снимка. Внутри найдено 11 локальных ссылок на
отсутствующие цели: в основном `stores-beta/user-guide.md`, а также
`../index.md#quick-start`. Документы содержат 55 строк с внешними URL или командами,
ориентированными на публичные сервисы.

Нужно либо перенести полный versioned snapshot с provenance и исправной картой
ссылок, либо исключить его из offline-комплекта и заменить ссылкой на проверенное
внутреннее зеркало. Команды `@latest`, GitHub, Discord и Nix/GitHub не должны быть
единственным маршрутом для пользователя закрытого контура.

### P2. Coverage не входит в обязательный check и не имеет порогов

Общее покрытие высокое, но `npm run check` запускает только lint и tests. Падение
coverage не блокирует проверку. Слабее всего покрыты пользовательские CLI-обёртки
(`connect.js` 28.57%, `record-verification.js` 34.29%, `assign.js` 42.11%) и
`shared/store.js` (59.52%).

Нужно определить минимальные пороги и добавить тесты фактического stdout/stderr,
exit codes и ошибок CLI-обёрток. Для закрытого контура отдельно проверить целевую ОС
и shell: текущий аудит выполнен только на macOS.

## Рекомендуемый порядок перед переносом

1. Утвердить полную OpenSpec/agent runtime matrix и внутренние источники пакетов.
2. Подготовить внутренние Git remotes и процедуру переноса Store identity.
3. Актуализировать README/runbook и добавить offline installation checklist.
4. Добавить real-OpenSpec smoke, docs-link/CLI-parity checks и coverage thresholds.
5. На чистой машине целевого контура выполнить `npm ci`, `npm run check`, compatibility
   smoke, `openspec store doctor`, `openspec context` и
   `openspec-orch repository status`.

## Граница вывода

Успешные 153 теста подтверждают текущую внутреннюю реализацию и сценарии на временных
Git-репозиториях. Они не подтверждают установку без внешней сети, целевую ОС,
доступность agent runtime и полный изолированный multi-repository pilot в закрытом
контуре.
