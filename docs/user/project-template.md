# Project Template

Project Template — copy-only набор project-local config, context, schemas и assets.
`openspec-orch init` применяет его один раз после штатного OpenSpec init.

## Template по умолчанию

Bundled Template `default` устанавливает:

- `openspec/config.yaml` и project context;
- schemas `spec-driven-extended` и `superspec-multirepo`;
- Extensions `spec-driven-extended` и `superpowers` как обязательные;
- объявленные assets, включая `.gitignore`.

Plugins и Agent gateway в Template не входят.

## Выбор schema

Один Store может содержать Changes с разными schemas. OpenSpec сохраняет выбор в
`.openspec.yaml` конкретного Change.

```bash
openspec new change update-copy --schema spec-driven-extended
openspec new change redesign-checkout --schema superspec-multirepo
```

| Schema | Artifact path |
|---|---|
| `spec-driven-extended` | Intake → Proposal/Specs/Design → Tasks → Verify |
| `superspec-multirepo` | Brainstorm → Proposal/Specs/Design → Tasks → Plan → Verify |

Не меняйте schema уже созданного Change для переключения процесса. Если DAG
несовместим, создайте новый Change и перенесите только принятый смысл.

Обе schemas используют одну Feature Acceptance: Agent собирает evidence, человек
явно принимает решение `PASS` или `FAIL`, а до решения gate остаётся `PENDING`.
Change Tracking не участвует в этом решении: он связывает OpenSpec tasks с revisions
Code Repositories. Verify не выполняет Release или Archive.

## Владение и обновление

После `init` скопированные файлы принадлежат Store. Повторный `init` не обновляет
их и не перезаписывает отличающийся target. Изменения Template переносятся отдельным
проверяемым PR Store по [процедуре миграции](installation-and-updates.md).

Не заменяйте несовместимый schema DAG, пока его используют активные Changes. Сначала
завершите и архивируйте их либо сохраните прежнюю schema под отдельным локальным ID.
После этого новые Changes можно создавать на обновлённой schema.

## Custom Template

Локальный Template состоит из descriptor и каталогов-источников:

```text
team-template/
├── template.yaml
├── context/
└── assets/
```

```yaml
id: team-product
name: Team Product Template
copy:
  - from: context
    to: openspec/context
  - from: assets/gitignore.template
    to: .gitignore
```

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --template /absolute/path/to/team-template
```

Custom Template полностью заменяет `default`. Merge нескольких Templates,
interpolation, conditions и delete rules не поддерживаются.

Copy engine запрещает path traversal, запись в `.git/`, `.openspec-store/` и
`openspec-orch.yaml`, symlinks, специальные файлы, collisions и перезапись
отличающегося файла.
