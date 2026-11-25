@AGENTS.md

## Claude Code specifics

- The built-in `plugin-authoring` skill knows the mods API; use it when writing a mod.
- `/reload-plugins` reloads mods in an open session; `claude --debug` shows hook failures and refused trees.
- Don't run `bun run link` or `bun run install-mods` unless asked: they change `~/.claude`.
