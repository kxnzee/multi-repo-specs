# Verification Report

> Generated after Apply for the exact iteration and candidate recorded below. Failed
> checks return to the owning artifact or Apply and require a new verification run.

**Change:** `<change-name>`

**Verified at:** `YYYY-MM-DD HH:mm`

**Apply iteration:** `<copy from apply.md>`
**Verifier:** `<agent and responsible participant where applicable>`

## 1. OpenSpec structural validation

- [ ] `openspec validate --all --json` reports every item valid.

```text
<fresh output summary>
```

## 2. Repository technical verification

| Repository ID | Commit | Fresh commands | TDD and review evidence | Result |
| --- | --- | --- | --- | --- |
| `<repository-id>` | `<identity>` | `<commands>` | `<evidence>` | `PASS` / `FAIL` |

## 3. Candidate identity

- **Repository commits:** `<exact identities>`
- **Build / image / artifact:** `<identity or N/A>`
- **Current:** `yes` / `no`

## 4. Artifact coherence

| Check | Result | Evidence / warning |
| --- | --- | --- |
| Tasks complete | `PASS` / `FAIL` | `<remaining items>` |
| Delta Specs sync state known | `PASS` / `FAIL` | `<capabilities>` |
| Design and Specs coherent | `PASS` / `WARN` / `FAIL` | `<sample>` |

## 5. External verification

- **Responsible participant:** `<name or pending>`
- **Current version / deployment:** `<identity or pending>`
- **Confirmation:** `confirmed` / `pending` / `failed`
- **Evidence:** `<reference without secrets>`

Agent reasoning, local tests and candidate identity cannot mark this confirmation complete.

## Overall Decision

- [ ] `PASS` — current iteration and candidate may proceed to Finalize.
- [ ] `PASS_WITH_WARNINGS` — may proceed; warnings are recorded below.
- [ ] `FAIL` — return to the owning artifact or Apply and re-run Verify.

**Warnings / failures:** `<details>`
**Next step:** `<action>`
