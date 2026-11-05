# Virtual Personas over Delta Specs (VPDS)

**One AI, four personas, delta specs, and human gates.** You get the role separation of a multi-agent framework without the agents.

VPDS runs inside the AI coding tool you already use (Claude Code or Cursor). The single AI switches between four tightly scoped personas (**PM → Designer → Architect → Developer/QA**). Each persona writes one kind of file into an [OpenSpec](https://github.com/Fission-AI/OpenSpec) change folder, and **a small script blocks the next persona until you approve the previous phase.**

```
/vp:pm ──► proposal.md ─┐
/vp:design ─► ux.md ────┴─► 🚦 approve ─► /vp:architect ─► design.md · specs/ · tasks.md
                                                             └─► 🚦 approve ─► /vp:build ─► tests + code
                                                                                  └─► openspec archive
```

## Why

Multi-agent frameworks such as BMAD and CrewAI separate roles well, but they cost you in three places:

- **Tokens:** every agent carries a long persona prompt and re-reads documents and conversation history.
- **Ceremony:** installers, agent teams, story sharding, and many documents for every change.
- **Speed:** a one-line fix goes through the same pipeline as a new product area.

VPDS keeps the part that matters (**each role only does its own job, and you sign off between them**) and cuts the rest:

- **One context at a time.** A fresh session after each gate means each persona reads only the approved files, never the previous persona's chat.
- **Short personas, loaded on demand.** Each persona is about 150–300 words and is loaded only by its own slash command.
- **Delta specs.** Personas read the change folder and only the specs it touches (OpenSpec), not the whole spec tree.
- **Tiers.** Small changes skip straight to the Developer; only large ones use all four personas.
- **Enforced gates.** `vpds/gate.mjs` is plain code, so approval doesn't depend on the AI choosing to obey.

## Folder structure

```
.
├── AGENTS.md                    # Shared rules: one persona at a time, file ownership, tiers
├── CLAUDE.md                    # @AGENTS.md (Claude Code reads AGENTS.md through this)
├── .claude/commands/vp/         # /vp:pm  /vp:design  /vp:architect  /vp:build
├── .cursor/commands/            # /vp-pm  /vp-design  /vp-architect  /vp-build
├── vpds/
│   ├── personas/                # pm.md · designer.md · architect.md · developer.md
│   ├── gate.mjs                 # status · approve · check (zero dependencies)
│   ├── lib.mjs                  # frontmatter, hashing, phase rules
│   └── *.test.mjs               # gate tests, including end-to-end with the OpenSpec CLI
├── bin/vpds.mjs                 # npx vpds init | update (+ install.test.mjs)
└── openspec/                    # ← also the Obsidian vault
    ├── config.yaml              # from `openspec init`
    ├── specs/                   # living specs (source of truth)
    ├── changes/<id>/            # proposal.md · ux.md · design.md · specs/ · tasks.md · pushback.md
    ├── _templates/              # tpl-proposal · tpl-ux · tpl-design · tpl-spec · tpl-tasks · tpl-pushback
    ├── changes.base             # Obsidian dashboard: awaiting review, pipeline board, archive
    ├── pipeline.canvas          # Obsidian canvas of the workflow
    └── .obsidian/               # vault settings (templates folder, relative links)
```

## Quickstart

Requires Node 20.11 or later. Works with any project language; Node is only needed for the gate scripts.

```bash
# 1. Install OpenSpec (once per machine)
npm i -g @fission-ai/openspec

# 2. Add VPDS to your project (run in the project root)
npx vpds init                    # or: npx vpds init --tools claude   (claude | cursor)

# 3. Start your first change (in Claude Code; Cursor uses /vp-pm)
/vp:pm Users want to export invoices as CSV for their accountant
```

`init` copies the kit, adds a managed block to your `AGENTS.md`, makes `CLAUDE.md` import it, adds the Obsidian lines to `.gitignore`, and runs `openspec init`. It never overwrites a file that already exists. Use `--dry-run` to preview and `--no-obsidian` to skip the vault files.

**Updating:** `npx vpds update` refreshes personas, commands, templates and gate scripts. Every installed file is recorded in `.vpds.json`; **files you've edited are skipped** (use `--force` to replace them), and `openspec/specs` and `openspec/changes` are never touched. Commit `.vpds.json` along with the rest.

**Optional: Obsidian.** Choose *Open folder as vault* and pick the `openspec/` folder. In Settings → Core plugins, turn on **Templates**, **Bases** and **Canvas**. Open `changes.base` to see what's waiting for your review.

## Single repo or many

VPDS works the same way in both. The only difference is one optional file.

**Single repo (default).** Run `npx vpds init` in the repo. Specs live in `openspec/` next to the code. There's nothing to configure.

**Several repos** (for example API, web app, mobile app, infra). Create a small **planning repo** next to them and install VPDS there with the list of code repos:

```
my-product/
├── planning/   ← npx vpds init --repos api=../api,web=../web,mobile=../mobile,infra=../infra
├── api/
├── web/
├── mobile/
└── infra/
```

- `vpds.config.json` records the repos and is the source of truth. Edit it, then run `npx vpds update` to resync the tool settings.
- **Claude Code:** open `planning/`. The installer adds the code repos to `.claude/settings.json` (`additionalDirectories`), so one session can work across all of them.
- **Cursor / VS Code:** open `vpds.code-workspace`, a multi-root workspace with the planning repo and every code repo.
- One change can span several repos. The Architect tags every task with its repo (`- [ ] 1.1 [api] Test: …`) and fills **Repos Affected** with the ship order. The gate blocks tasks that are untagged or use an unknown repo, and repos missing on disk.
- The Developer works, tests and commits inside each task's repo, on the branch `feat/<change-id>`, so the related PRs are easy to find.
- `node vpds/gate.mjs repos` shows the setup; `status` shows which repos each change touches.

Why one planning repo instead of VPDS in every repo? A feature that touches the API and the app stays **one** change with **one** approval, and one place describes the whole behaviour.

## How a change moves

| Step | You run | What happens |
|---|---|---|
| 1 | `/vp:pm <idea>` | PM creates the change and writes `proposal.md` with a **tier** |
| 2 | `/vp:design <id>` *(large only)* | Designer writes `ux.md`: flows, wireframes, states, a11y |
| 🚦 | `node vpds/gate.mjs approve <id>` *(large)*, then `/clear` | Gate 1 |
| 3 | `/vp:architect <id>` | Architect writes `design.md`, delta specs and `tasks.md`; must pass `openspec validate --strict` |
| 🚦 | `node vpds/gate.mjs approve <id>`, then `/clear` | Gate 2: every file is locked with a hash |
| 4 | `/vp:build <id>` | Developer runs `gate.mjs check`, then for each task: failing test → code → refactor → tick |
| 5 | `openspec archive <id>` | Delta specs merge into `openspec/specs/` |

| Tier | When | Flow | Approvals |
|---|---|---|---|
| **small** | No behaviour change or a trivial fix | `/vp:build "<request>"` | 0 (review the diff) |
| **medium** | New or changed behaviour | PM → Architect → 🚦 → Dev | 1 |
| **large** | New screens/flows or data model | PM → Designer → 🚦 → Architect → 🚦 → Dev | 2 |

**Pushback.** If the Developer finds a gap in the spec, it opens `pushback.md` instead of working around it. That blocks the build until the Architect resolves it and you approve again.

## The gate

```bash
node vpds/gate.mjs status                   # every open change, its tier, repos and each file's status
node vpds/gate.mjs repos                    # single-repo, or each code repo and its current branch
node vpds/gate.mjs check <id> build         # exit 0 = this persona may start; 1 = blocked, with reasons
node vpds/gate.mjs approve <id> [files…]    # you only: approves files in review and locks them
/vp:approve <id>                            # same, from chat (opt-in "chat" approval mode, below)
```

- **Human-only approval.** By default, `approve` refuses to run without an interactive terminal (AI tools run commands without one) and asks `[y/N]` before writing.
- **Edit detection.** Approval stores `approved_hash` for each file and `specs_hash` for the delta specs. If anything changes afterwards, `check` blocks. Ticking task checkboxes doesn't count as a change.
- **Obsidian-friendly.** Setting `status: approved` by hand still passes, with a warning that the file has no hash lock.

### Approval modes

| Mode | How you approve | What keeps the AI from approving |
|---|---|---|
| `terminal` (default) | `node vpds/gate.mjs approve <id>` in your own terminal | AI tools have no interactive terminal, so `approve` refuses |
| `chat` (opt-in) | Type `/vp:approve <id>`, then click **Allow** on the tool's permission prompt | The command can only be typed by you (`disable-model-invocation`), and every `gate.mjs approve` hits an `ask` rule in `.claude/settings.json` |

Turn on chat mode with `npx vpds init --approval chat` (or `npx vpds update --approval chat`), or set `"approval": "chat"` in `vpds.config.json`. Every approval records `approved_via: terminal | chat`.

**Chat mode is only as strong as the permission prompt.** Don't use it with auto-accept or "bypass permissions" modes, and never choose "always allow" for `gate.mjs approve`. In Cursor, keep "ask before running commands" on. In either mode, an AI that can edit files could still forge the `status:` line by hand; the rules forbid it and the hash lock catches edits made after a real approval.

## VPDS compared with multi-agent frameworks

| | **VPDS** | **BMAD Method** | **CrewAI** | **Plain OpenSpec** |
|---|---|---|---|---|
| What it is | Rules + 4 personas in your AI tool | Agent team + workflows in your AI tool | Python multi-agent framework | Spec workflow in your AI tool |
| Agents / contexts | 1 at a time, fresh after each gate | Many role agents | Many agents, each with its own LLM calls | 1 |
| Role separation | ✅ Hard file ownership | ✅ | ✅ | ❌ One role drafts everything |
| Human sign-off | ✅ Enforced by script + hash lock | Workflow convention | You build it | Convention |
| Multi-repo products | ✅ Planning repo + `[repo]`-tagged tasks, gate-checked | — | — | Stores (standalone planning repo) |
| Scales to change size | ✅ small / medium / large | Mostly full pipeline | You build it | ✅ |
| Spec format | OpenSpec deltas (validated) | PRD, architecture, sharded stories | None built in | OpenSpec deltas |
| Setup | `openspec init` + copy files | Installer + config | Python project + code | `openspec init` |
| Runtime dependencies | None (Node built-ins) | Installer | Python packages | OpenSpec CLI |

**On token cost:** VPDS is designed to spend fewer tokens: one active persona, no messages passed between agents, history cleared at every gate, and only delta specs read. The savings depend on your project and tools, so **we don't quote a percentage**. To measure it on your own work, run the same feature through each framework and compare the usage your tool reports (for example `/cost` in Claude Code). Benchmark results are welcome as pull requests.

## Limitations

- Personas are enforced by **prompt** for what they write, and by **script** only for when they may start. A misbehaving AI could still edit a file it doesn't own. The hash lock catches that at the next `check`, but it doesn't prevent it.
- An AI tool that runs commands in a real terminal could reach the `approve` prompt. Review your tool's command permissions.
- Supports Claude Code and Cursor today. Other tools that read `AGENTS.md` should work but need their own command wrappers.

## Roadmap

- Command wrappers for Roo Code, GitHub Copilot and Windsurf
- Optional pre-commit hook: block code commits while a change's gate is closed
- Published token benchmarks

## License

[MIT](LICENSE) © 2026 Wendt Edmund
