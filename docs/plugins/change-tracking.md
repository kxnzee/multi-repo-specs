# Change Tracking

Change Tracking связывает задачу OpenSpec с PR, планом и точными ревизиями
реализации. Он помогает передать незавершённую работу, но не создаёт ветки, PR,
Verify, Archive или Release.

Подключите плагин к Store и к каждому репозиторию кода, где выполняется Apply:

```bash
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

Плагин хранит связи задач с PR, планом и точными SHA в
`openspec/changes/<change-id>/implementation-map.yaml`. Агент записывает связь
через `record_implementation`; ручной вариант доступен через `plugin exec ... record`.
Галочки задач OpenSpec, ветки, PR, Verify, Archive и Release плагин не меняет.
Для незавершённой работы сохраните ссылку на PR, выполненные SHA и оставшиеся шаги
в доступной участникам ветке Store.

Диагностика и отключение описаны в [общем lifecycle](operations.md). Реализация
плагина находится в `plugins/change-tracking/`.
