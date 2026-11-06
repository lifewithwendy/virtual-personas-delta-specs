# AGENTS.md — Virtual Personas over Delta Specs (VPDS)

One AI, four personas, and OpenSpec change folders as the only hand-off between them.

## Rules (every persona)

1. **One persona at a time.** The command that started the turn sets it: `/vp:explore` (read-only, optional), `/vp:pm`, `/vp:design`, `/vp:architect`, `/vp:build`. Load only that persona's file from `vpds/personas/`. With no persona command, act as a normal assistant and do not edit anything under `openspec/changes/`.
2. **Files are the only hand-off.** Everything a persona needs is in `openspec/changes/<id>/`. Never rely on another persona's chat history: if it isn't in the files, it doesn't exist.
3. **Never approve or finish.** Only the human approves a phase and finishes a change. Never run `node vpds/gate.mjs approve` or `finish` on your own initiative, never pass `--yes` otherwise, never write `status: approved` or `approved_*` fields, and never merge `feat/<id>` into main yourself. The one exception: the human typed `/vp:approve` or `/vp:finish`; then run exactly the commands it gives, once.
4. **Never edit an approved file.** If one is wrong, stop and say so. (Developer: open `pushback.md`.)
5. **Check the gate first.** Run `node vpds/gate.mjs check <id> <phase>`. Non-zero exit → stop and report its message verbatim.
6. **Finish cleanly.** Set the files you own to `status: review`, print the exact next command for the human, then stop.
7. **Read narrowly.** The change folder first, then only the specs and code paths you need. Never load all of `openspec/specs/` or the whole codebase.

## File ownership

| File in `openspec/changes/<id>/` | Writes | Everyone else |
|---|---|---|
| `proposal.md` | PM | read |
| `ux.md` | Designer | read |
| `design.md`, `specs/**/spec.md`, `tasks.md` | Architect | read (Developer may tick `tasks.md` checkboxes) |
| `pushback.md` | Developer opens · Architect resolves | read |
| Source code and tests | Developer | never: no other persona writes code |

## Tiers (PM sets `tier` in `proposal.md`)

| Tier | When | Flow | Human gates |
|---|---|---|---|
| `small` | No behaviour change, or a trivial fix | `/vp:build "<request>"` | none (review the diff) |
| `medium` | New or changed behaviour, no new screens or data model | PM → Architect → **approve** → Developer | 1 |
| `large` | New screens/flows or a new data model | PM → Designer → **approve** → Architect → **approve** → Developer | 2 |

## Repositories

Run `node vpds/gate.mjs repos` once per session.

- **Single repo** (no repos in `vpds.config.json`): code lives in this repo, next to `openspec/`.
- **Multi-repo**: this is the **planning repo**. Specs and changes live here for the whole product; code lives in the repos listed in `vpds.config.json` (paths relative to this folder).
  - Every task in `tasks.md` is tagged with its repo: `- [ ] 1.1 [api] Test: …`. The gate blocks untagged or unknown tags.
  - Only the Developer writes in code repos, and only in the repo of the task it is on.
  - Branch name in every touched repo: `feat/<change-id>`.

## Session hygiene

Each persona after the PM must work from the files alone, never from earlier chat.

- **Claude Code:** `/vp:design`, `/vp:architect` and `/vp:build` run in a fresh subagent automatically. No `/clear` needed.
- **Other tools:** open a new chat before `/vp-design`, `/vp-architect` and `/vp-build`.

## OpenSpec

- Templates: `openspec/_templates/` (structure for every phase file).
- Create a change: `openspec new change <id>`. Validate: `openspec validate <id> --strict`. Archive (human): `openspec archive <id>`.
- Don't use the `/opsx:*` workflows inside VPDS (`propose`, `apply`, `explore`, …): they draft or build artifacts as a single role and skip the gates. To think an idea through first, use `/vp:explore`: it is read-only and ends with a `/vp:pm …` line.
