---
description: VPDS: approve a change's files in review (human only, chat approval mode)
argument-hint: <change-id> [files...]
disable-model-invocation: true
---
The human typed `/vp:approve` to approve: $ARGUMENTS

Do exactly this, nothing else:

1. Run `node vpds/gate.mjs status` and show the line for this change.
2. Run `node vpds/gate.mjs approve $ARGUMENTS --yes`, exactly once. Claude Code will ask the human to allow it: that click is the approval.
3. If it fails, show the error and stop. Never retry with another command, never edit `status:` or `approved_*` fields by hand.
4. On success, show the "Approved:" line and the next /vp:* command (it runs in a fresh subagent, so no `/clear` is needed).
