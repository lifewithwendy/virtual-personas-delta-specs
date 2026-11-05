---
description: VPDS: merge a finished change into main in every repo and archive it (human only, chat approval mode)
argument-hint: <change-id>
disable-model-invocation: true
---
The human typed `/vp:finish` to finish: $ARGUMENTS

Do exactly this, nothing else:

1. Run `node vpds/gate.mjs finish $ARGUMENTS --yes --dry-run` and show the plan.
2. Run `node vpds/gate.mjs finish $ARGUMENTS --yes`, exactly once. Claude Code will ask the human to allow it: that click is the go-ahead.
3. If it fails (BLOCKED or a merge conflict), show the message and stop. Never merge, archive, commit or resolve conflicts another way.
4. On success, show the "Done" line. Remind the human that nothing was pushed.
