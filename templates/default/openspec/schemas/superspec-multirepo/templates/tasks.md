# Implementation Tasks

> **Execution:** Для реализации этого OpenSpec Change вызови установленный
> штатный OpenSpec Apply и следуй актуальным инструкциям схемы. `tasks.md` —
> единственный принятый план; Superpowers executor запускается внутри Apply.
> Создание Tasks не запускает реализацию.

**Change:** <!-- change-id and one-sentence goal -->

**Accepted inputs:** <!-- proposal, Delta Specs and optional design -->

**Repository order:** <!-- dependencies between repository results, or explicitly none -->

## 1. `<repository-id>`

**Repository result:** <!-- observable result owned by this repository -->

**Depends on:** <!-- another repository result, or none -->

- [ ] 1.1 <!-- Stable task title and required result. -->
  - **Traces to:** <!-- Requirement and Scenario IDs. -->
  - **Files or anchors:** <!-- Exact paths or current-state anchors to confirm at Apply time. -->
  - **Steps:**
    1. <!-- One 2-5 minute TDD or implementation action. -->
    2. <!-- Next small action. -->
  - **Verification:**
    - Command: `<!-- exact repository command -->`
    - Expected: <!-- observable successful result -->
  - **Review checkpoint:** <!-- focused review question for this result -->

## 2. `<other-repository-id>`

**Repository result:** <!-- observable result owned by this repository -->

**Depends on:** <!-- another repository result, or none -->

- [ ] 2.1 <!-- Stable task title and required result. -->
  - **Traces to:** <!-- Requirement and Scenario IDs. -->
  - **Files or anchors:** <!-- Exact paths or current-state anchors to confirm at Apply time. -->
  - **Steps:**
    1. <!-- One small action. -->
    2. <!-- Next small action. -->
  - **Verification:**
    - Command: `<!-- exact repository command -->`
    - Expected: <!-- observable successful result -->
  - **Review checkpoint:** <!-- focused review question for this result -->

## Cross-repository convergence

<!-- Assign compatibility checks to one existing task in the Repository that owns
the evidence. State ordering and absent/old-version behavior without adding a second
checkbox for the same result. -->
