# OpenSpec Graph language

## Glossary

### Store

The single OpenSpec requirements repository compiled by the graph. Its Orchestrator
Store ID is the stable root identity.

### Repository

A registered Code Repository from `openspec-orch.yaml`. Files, symbols and runtime
calls inside it belong to CodeGraph rather than OpenSpec Graph.

### Master Spec

The current normative capability under `openspec/specs/`. A planned Master Spec may
exist before Archive when an active Delta Spec introduces a new capability. It remains
visible even when no active Change affects it.

### Change

One active or archived OpenSpec Change. It groups Delta Specs and contains the
Repository Impact used to relate exact Repositories to exact capabilities.

### Delta Spec

One capability-specific specification inside a Change. Its standard sections carry
the exact `ADDED`, `MODIFIED`, `REMOVED` and `RENAMED` operations.

### Repository Impact

The strict `Repository | Capabilities` table in a Change Proposal. Every row maps one
registered Repository to one or more exact capability paths that have Delta Specs in
the same Change. A free-form Repository list is not Repository Impact for graph
compilation.

### Repository–Master Spec relation

A neutral relation derived when the same Change maps a Repository in Repository Impact
and affects a Master Spec through a Delta Spec. It means only that the Repository
participated in a Change affecting the capability. It does not assert ownership,
implementation, runtime calls or technical dependency.

### Unlinked Master Spec

A Master Spec for which no valid Repository–Master Spec relation can be derived from
active or archived Changes. It remains a graph node and produces the
`UNLINKED_MASTER_SPEC` warning.

### Graph Report

The immutable result of compiling the current Store for `graph inspect` or
`graph view`. It contains nodes, edges, diagnostics and summary counts. The report may
be `ready` or `invalid`. Every edge contains structured `{ path, line, field }`
provenance. Recoverable diagnostics without an affected node or edge are displayed in
the viewer as graph-level diagnostics.
