## Why

<!-- Explain the motivation for this change. What problem does this solve? Why now? -->

## What Changes

<!-- Describe what will change. Be specific about new capabilities, modifications, or removals. -->

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Use kebab-case for path segments you introduce
     (e.g., user-auth or identity/user-auth) that follow the project's existing
     spec organization. Each creates specs/<capability-path>/spec.md. -->
- `<capability-path>`: <brief description of what this capability covers>

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use the exact existing path under openspec/specs/. Leave empty if no requirement
     changes. A change with no capabilities at all (pure refactor, tooling, docs)
     must set `skip_specs: true` in its .openspec.yaml - openspec validate rejects
     a zero-delta change without that marker. Do not invent a requirement just to
     satisfy validation. -->
- `<existing-capability-path>`: <what requirement is changing>

## Repository Impact

<!-- List only registered Code Repositories that this Change modifies. Every capability
     must be an exact path from New Capabilities or Modified Capabilities above.
     With skip_specs and no capabilities, this mapping cannot be populated under
     the current Graph contract. Report that incompatibility before Apply; do not
     invent a capability or use an empty cell / N/A as a substitute. -->
| Repository | Capabilities |
| --- | --- |
| `<repository-id>` | `<capability-path>` |

## Impact

<!-- Affected code, APIs, dependencies, systems -->
