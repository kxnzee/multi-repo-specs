# Spec Document Reviewer Prompt Template

Use this template when dispatching a spec document reviewer subagent.

**Purpose:** Verify the spec is complete, consistent, and ready for implementation planning.

This is an optional template for explicit dispatch. The default authoring skill
uses inline self-review; this file does not add an automatic gate.

**Dispatch after:** The requested document is written to the resolved `SPEC_FILE_PATH`.
Use the path and applicable artifact instructions supplied by the caller; do not
assume a directory, filename or next lifecycle stage.

```
Subagent (general-purpose):
  description: "Review spec document"
  prompt: |
    You are a spec document reviewer. Verify this spec is complete and ready for planning.

    **Spec to review:** [SPEC_FILE_PATH]

    **Accepted intent / requirements:** [SOURCE_PATHS_OR_TEXT]
    **Artifact instructions and project constraints:** [APPLICABLE_INSTRUCTIONS]
    **Repository scopes and task dependencies:** [SCOPES_AND_DEPENDENCIES_OR_NOT_APPLICABLE]

    ## Review Boundaries

    Read only the supplied documents and their explicitly required references.
    Do not edit artifacts, inspect Code Repositories, advance lifecycle stages,
    or delegate further. If a required source is unavailable or contradictory,
    return Blocked with the missing input or unresolved decision. Do not invent
    requirements. Approval is a technical assessment, not a human gate.
    Check coverage against accepted sources, not only the document's own claims.
    Respect the supplied artifact instructions: permitted open questions or
    deferred decisions are not automatically defects. For multi-repository work,
    check explicit ownership, cross-repository dependencies and sequencing.

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Requirements ambiguous enough to cause someone to build the wrong thing |
    | Scope | Focused enough for a single plan — not covering multiple independent subsystems |
    | YAGNI | Unrequested features, over-engineering |

    ## Calibration

    **Only flag issues that would cause real problems during implementation planning.**
    A missing section, a contradiction, or a requirement so ambiguous it could be
    interpreted two different ways — those are issues. Minor wording improvements,
    stylistic preferences, and "sections less detailed than others" are not.

    Approve unless there are serious gaps that would lead to a flawed plan.

    ## Output Format

    ## Spec Review

    **Status:** Approved | Issues Found | Blocked

    **Coverage:** [sources and sections checked; anything not verified]
    **Missing inputs (if Blocked):** [required source or decision]

    **Issues (if any):**
    - [Section X]: [specific issue] - [why it matters for planning]

    **Recommendations (advisory, do not block approval):**
    - [suggestions for improvement]
```

**Reviewer returns:** Status, Issues (if any), Recommendations
