# VPDS finish (human only, chat approval mode)

The human typed this command to finish the change named after it.

1. Run `node vpds/gate.mjs finish <change-id> --yes --dry-run` and show the plan.
2. Run `node vpds/gate.mjs finish <change-id> --yes`, exactly once, and wait for the human to allow it.
3. If it fails, show the message and stop. Never merge, archive or commit another way.
4. On success, remind the human that nothing was pushed.
