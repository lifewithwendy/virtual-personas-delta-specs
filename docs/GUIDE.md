# Using VPDS: the short version

## Once per project

1. **Install OpenSpec** (once per machine): `npm i -g @fission-ai/openspec`
2. **Add VPDS**, in the repo (single repo) or in a planning repo next to your code repos.
   Until VPDS is on npm, use `npx github:lifewithwendy/virtual-personas-delta-specs` in place of `npx vpds`:
   ```bash
   npx vpds init                                        # single repo
   npx vpds init --repos api=../api,web=../web          # several repos
   npx vpds init --approval chat                        # add this to approve with /vp:approve
   ```
3. **Commit** what it added.
4. **Recommended:** in each code repo, add a `.gitattributes` with `* text=auto eol=lf`, so Windows editors don't show whole-file diffs.

## For every feature

| Step | You type | You do |
|---|---|---|
| 0. Think it through *(optional)* | `/vp:explore <rough idea>` | Talk it over. It writes nothing and ends with the `/vp:pm …` line to run. |
| 1. Describe it | `/vp:pm <the feature in one sentence>` | Answer its questions. It picks the tier. |
| 2. Design it *(large only)* | `/vp:design <id>` | |
| 3. Plan it | `/vp:architect <id>` | |
| 4. **Review and approve** | `/vp:approve <id>` or `node vpds/gate.mjs approve <id>` | Read `proposal.md`, `design.md`, `tasks.md`. This is where you steer. |
| 5. Build it | `/vp:build <id>` | Wait. It tests first, commits per task, and stops if a spec is wrong. |
| 6. Check and finish | `/vp:finish <id>` or `node vpds/gate.mjs finish <id>` | Review the diffs and do the manual checks it lists. `finish` merges `feat/<id>` into main in every repo, archives the change and commits. Push when ready. |

Large changes approve twice: after step 2 (proposal + UX) and after step 3.
Tiny fixes skip it all: `/vp:build "fix the typo on the login button"`.

## When something goes wrong

| You see | Do |
|---|---|
| `BLOCKED: … needs your approval` | Review, then approve. |
| `BLOCKED: … changed after approval` | Someone edited an approved file. Read the diff, then approve again (or revert). |
| `BLOCKED: pushback.md is open` | The Developer found a spec gap. `/vp:architect <id>` to fix it, then approve again. |
| `finish`: `merge conflict, merge aborted` | Resolve it in that repo (`git merge feat/<id>`, fix, commit), then run `finish` again. |
| `BLOCKED: task 2.3 has no [repo] tag` | Multi-repo: ask the Architect to tag it, approve again. |
| The Architect stops with questions | Answer them: `/vp:architect <id> <your answers>`. |
| A persona guesses or asks something the spec should have said | Add the heading to the template in `openspec/_templates/` so next time it's asked up front. |

## Three habits

1. **Steer at the gate, not during the build.** Changing your mind mid-build means editing a spec, which (correctly) blocks the build.
2. **Let the personas start fresh.** In Claude Code, `/vp:design`, `/vp:architect` and `/vp:build` run in a fresh subagent automatically. In Cursor, open a new chat before each of them.
3. **Keep proposals short.** If it doesn't fit on a page, it's two changes.

Anytime: `node vpds/gate.mjs status` (what's open, with the real change ids) and `node vpds/gate.mjs repos` (which repos).
Not sure? Add `--dry-run` to `finish` to see exactly what it would do.
