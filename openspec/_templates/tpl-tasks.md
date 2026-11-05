---
persona: architect
tier: medium
status: draft
approved_by:
approved_at:
approved_hash:
---
# Tasks

<!-- Dependency order. Each behaviour = a Test task then an Implement task.
     Each task says how to verify it. Tests live in the group that needs them, not at the end.
     Multi-repo: tag EVERY task with its repo right after the number, e.g. "1.1 [api] Test: …" -->

## 1. Group name

- [ ] 1.1 Test: behaviour under test (verify: `test command` fails for the right reason)
- [ ] 1.2 Implement: unit of work (verify: 1.1 passes)

## 2. Group name

- [ ] 2.1 Test: …
- [ ] 2.2 Implement: …
