# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview): plugins that run
*inside* Claude Code and draw UI, react to events or change how it behaves. They work in the
**CLI** (2.1.287 or later) and in the **Code tab of Claude Desktop**.

The repo is a plugin marketplace named `chofito-mods`; each folder under `mods/` is one mod.

## Mods

### [`usage-hud`](mods/usage-hud)

A bar above the prompt with your live usage:

```
 💬 7  🧠 220k/1M  🧊 57:12                    🔋 5h ▰▰▰▰▰▰▱▱▱▱ 62% 14%/h  ⏳ 2h14m  📅 7d ▰▰▰▰▰▰▱▱▱▱ 59%  💰 $1.23
```

- **Turn** and **context window** (tokens used / window).
- **Prompt cache** countdown, with alerts at 15, 10, 5 and 1 minutes left, and what re-caching
  the conversation will cost when it's about to expire.
- **5-hour limit**: what's left, your pace (%/hour) and, if that pace runs it out before the
  reset, at what time. Plus the countdown to the reset.
- **Weekly limit** and its reset date.
- **Session cost** at API prices (as `/cost`, even on a subscription), and the last turn's cost
  for a few seconds after it ends.

Details and options: [mods/usage-hud/README.md](mods/usage-hud/README.md).

## Quick install

In Claude Code (terminal or Desktop):

```
/plugin marketplace add Chofito/claude-mods
/plugin install usage-hud@chofito-mods
/reload-plugins
```

Update later with `/plugin marketplace update chofito-mods`. Change a mod's options in
`/config`.

### From a clone

Needs [Bun](https://bun.sh).

```sh
git clone https://github.com/Chofito/claude-mods && cd claude-mods
bun install
bun run link        # loads every mod live from the repo (CLI and Desktop); undo with `bun run unlink`
```

`bun run link` adds the mods to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`
(backed up to `settings.json.bak`); saving a file hot-reloads the mod. For another config
directory: `CLAUDE_CONFIG_DIR=~/.claude-work bun run link`.

## Develop

```sh
bun run dev usage-hud              # claude with the mod loaded, hot reload on save
bun run preview                    # draws usage-hud's bar in your terminal, no Claude Code needed
bun run check                      # typecheck + validate + tests, every mod
bun run new my-mod "What it does"  # scaffolds a mod and lists it in the marketplace
bun run types:update               # refreshes types/claude-code.d.ts from your Claude Code
```

The rules for writing mods (for people and agents) are in [AGENTS.md](AGENTS.md). Mods docs:
[overview](https://code.claude.com/docs/en/plugins/mods/overview) ·
[reference](https://code.claude.com/docs/en/plugins/mods/reference) ·
[testing](https://code.claude.com/docs/en/plugins/mods/test).

## License

[MIT](LICENSE)
