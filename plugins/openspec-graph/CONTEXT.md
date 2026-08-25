# OpenSpec Graph language

## Glossary

### Store

The single OpenSpec requirements repository that owns the graph. Its Orchestrator
Store ID is the stable root identity.

### Repository

A registered Code Repository that implements or verifies behavior. Files, symbols
and calls inside it belong to CodeGraph rather than OpenSpec Graph.

### Master Spec

The current normative capability under `openspec/specs/`. A planned Master Spec may
exist before Archive when an active Delta Spec introduces a new capability.

### Change

One active or archived OpenSpec Change. It groups its Delta Specs and represents
planned requirement movement, not proof of implementation, deployment or Archive.

### Delta Spec

One capability-specific specification inside a Change. Its standard sections carry
the exact `ADDED`, `MODIFIED`, `REMOVED` and `RENAMED` operations.

### Directly Changed Master Spec

A Master Spec whose capability has a Delta Spec inside the selected Change. This is
direct planned scope, regardless of how many other Master Specs depend on it.

### Dependent Master Spec

A Master Spec that directly or transitively `depends_on` a Directly Changed Master
Spec. Dependency impact follows the reverse direction of `depends_on`: if A depends
on B and B changes, A is potentially affected. B is not inferred to be affected when
only A changes.

### Total Impact

The union of Directly Changed Master Specs and Dependent Master Specs, without
duplicates. Total Impact is potential requirement impact based only on explicit,
evidenced dependencies; it is not proof that implementation work is required.

### Direct Repository

A Repository targeted by a Delta Spec in the selected Change or implementing a
Directly Changed Master Spec.

### Dependent Repository

A Repository implementing a Dependent Master Spec. A Repository present in both
groups remains part of the direct group and appears once in the total Repository set.

### Repository relation direction

- `source depends_on target`: a change to `target` reviews `source`; a change to
  `source` does not review `target` automatically.
- `source calls target`: `source` is the caller and `target` provides the named
  contract; a provider change reviews the caller, not the reverse automatically.
- `source publishes_to target`: `source` publishes the named event contract and
  `target` is its direct consumer Repository. This is topology evidence only; it does
  not add either Repository to impact or review automatically.
