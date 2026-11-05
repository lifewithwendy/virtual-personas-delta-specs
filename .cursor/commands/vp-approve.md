# VPDS approve (human only, chat approval mode)

The human typed this command to approve the change named after it.

1. Run `node vpds/gate.mjs status` and show the line for this change.
2. Run `node vpds/gate.mjs approve <change-id> --yes`, exactly once, and wait for the human to allow it.
3. If it fails, show the error and stop. Never retry another way, never edit `status:` or `approved_*` fields by hand.
4. On success, remind the human to start a new chat before the next persona.
