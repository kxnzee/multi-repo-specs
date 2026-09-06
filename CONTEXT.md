# OpenSpec Orchestrator

Контекст описывает язык координации одной Jira Story между центральным OpenSpec
Store и независимыми Code Repositories.

## Language

**Jira Story**:
Принятая владельцем продукта единица поставки, которая объединяет требования,
участников и подзадачи.
_Avoid_: Story branch, OpenSpec Change

**OpenSpec Change**:
Нормативный набор Planning-артефактов и Delta Specs, связанный с одной Jira Story.
_Avoid_: Jira Story, кодовая ветка

**Store**:
Отдельный Git-репозиторий, которому принадлежат OpenSpec Changes, Master Specs и
проектный контекст.
_Avoid_: Code Repository, репозиторий приложения

**Code Repository**:
Git-репозиторий с реализацией одного компонента, но без локальной копии нормативного
OpenSpec Change.
_Avoid_: Store, репозиторий спецификаций

**Store Story branch**:
Временная интеграционная ветка Jira Story, созданная от Integration branch Store
по pattern из проектного Git-контракта.
Planning, подзадачные обновления и Archive попадают в неё только через PR.
_Avoid_: Jira Story, code feature branch

**Subtask Store PR**:
PR из ветки подзадачи в Store Story branch, который публикует изменение Planning,
Tasks или evidence конкретной подзадачи.
_Avoid_: Code PR, Story Store PR

**Code PR**:
PR с реализацией подзадачи в Integration branch соответствующего Code Repository.
_Avoid_: Subtask Store PR, Story Store PR

**Story Store PR**:
Финальный PR из Store Story branch в Integration branch Store после Verify и Archive.
_Avoid_: Code PR, Planning PR

**Git Flow**:
Единая для Store и всех Code Repositories проекта модель с Production,
Integration, work, Release и Hotfix branches. Конкретные имена и patterns объявлены
в проектном контексте и не валидируются Orchestrator.
_Avoid_: локальная Git-конвенция отдельного Repository, SDD lifecycle

**Implementation candidate**:
Точный набор revisions и собранных artifacts Code Repositories, переданный на ИФТ
и проверяемый как единое целое.
_Avoid_: имя ветки, последний произвольный build

**Archive**:
Штатная OpenSpec-операция, которая применяет Delta Specs к Master Specs и перемещает
Change в архив до передачи Jira Story на UAT.
_Avoid_: Release, deployment
