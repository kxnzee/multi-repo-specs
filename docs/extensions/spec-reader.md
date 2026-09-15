# Spec Reader

Расширение `spec-reader` даёт агенту навык `specs-to-business`: он создаёт
человекочитаемый пересказ мастер-спек. Это производное представление, а не
подтверждение реализации или согласования требований.

В выбранном Store подключите расширение:

```bash
openspec-orch extension init spec-reader
openspec-orch extension connect spec-reader
openspec-orch extension status spec-reader
```

Затем попросите агента использовать `specs-to-business` для конкретной capability.
Пересказ появится в `docs/business/<capability>.md` выбранного Store.
Для всей системы явно попросите обработать все мастер-спеки; в этом режиме также
создаётся оглавление `docs/business/README.md`. Источник — `openspec/specs/**/spec.md`,
не код и не Changes. Автоматического обновления после Archive нет.

Исходные манифесты лежат в `extensions/spec-reader/`.
