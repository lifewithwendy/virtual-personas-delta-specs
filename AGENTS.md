# AGENTS.md — Virtual Personas over Delta Specs (VPDS)

One AI, four personas, and OpenSpec change folders as the only hand-off between them.

## Rules (every persona)

1. **One persona at a time.** The command that started the turn sets it: `/vp:pm`, `/vp:design`, `/vp:architect`, `/vp:build`. Load only that persona's file from `vpds/personas/`. With no persona command, act as a normal assistant and do not edit anything under `openspec/changes/`.
2. **Files are the only hand-off.** Everything a persona needs is in `openspec/changes/<id>/`. Never rely on another persona's chat history: if it isn't in the files, it doesn't exist.
3. **Never approve.** Only the human sets `status: approved`. Never run `node vpds/gate.mjs approve`, and never write `approved_*` fields.
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

## Session hygiene

Start a fresh session (`/clear` or a new chat) after every human approval. The next persona must work from the approved files alone.

## OpenSpec

- Templates: `openspec/_templates/` (structure for every phase file).
- Create a change: `openspec new change <id>`. Validate: `openspec validate <id> --strict`. Archive (human): `openspec archive <id>`.
- Don't use `/opsx:propose` or `/opsx:apply` inside VPDS: they draft or build every artifact as a single role and skip the gates. `/opsx:explore` is fine for thinking out loud.
