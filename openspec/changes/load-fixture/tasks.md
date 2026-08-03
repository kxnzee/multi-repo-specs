# Tasks: load-fixture

```yaml
work_packages:
  - id: UI-01
    repository: ui
    type: implements
    scenario_ids: [FIX-001, FIX-002]
  - id: BACKEND-01
    repository: backend
    type: implements
    scenario_ids: [FIX-003]
  - id: CONFIG-01
    repository: configuration
    type: enables
    ac_ids: [AC-FIX-001]
```
