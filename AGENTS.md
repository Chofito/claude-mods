# AGENTS.md

Instructions for AI agents (Claude Code, Codex, opencode…) working in this repo.

## What this repo is

A monorepo of **Claude Code mods**, published as one plugin marketplace named
`chofito-mods` (`.claude-plugin/marketplace.json`). Each mod is a complete
plugin under `mods/<name>/`. Mods run inside Claude Code (CLI ≥ 2.1.287, and the
Code tab of the Desktop app) as JavaScript/TypeScript event handlers.

## Layout

```
.claude-plugin/marketplace.json   every mod must be listed here
types/claude-code.d.ts            the mods API declarations (vendored; `bun run types:update`)
scripts/                          Bun scripts: dev, preview, validate/test, install, scaffold
mods/<name>/
  .claude-plugin/plugin.json      the plugin manifest
  hooks/hooks.json                { "modules": ["./register.ts"] }
  hooks/register.ts               entry point: export function register(on, options)
  hooks/*.ts                      pure helpers, imported by register.ts
  tests/*.test.ts                 run by `claude plugin test` (kit: 'claude-code/testing')
  README.md
```

## Commands (Bun, never npm/node)

| Command | Does |
| :- | :- |
| `bun run dev [mod…]` | `claude --plugin-dir` for each mod; saving a file hot-reloads it |
| `bun run preview [-- --live\|--desktop\|--unicode]` | usage-hud only: the band in the terminal (ANSI), or an HTML page with the Desktop SVGs |
| `bun run check` | typecheck + validate + test, all mods. **Run before you finish.** |
| `bun run typecheck` / `validate` / `test` | one step each; `validate`/`test` take mod names |
| `bun run new <name> "desc"` | scaffolds a mod and lists it in the marketplace |
| `bun run link` / `unlink` | adds/removes the mods in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (CLI + Desktop, live from the repo) |
| `bun run install-mods` | adds this repo as a marketplace and installs every mod |

## Rules for writing mods

- **Keep every `$` call in `register.ts`, spelled literally** (`$.session.usage()`,
  not `const s = $.session; s.usage()`). `claude plugin validate` reads `on(...)`
  and `$.namespace.method(...)` from source to list what a mod does. Helpers
  that take `$` must be top-level functions.
- **Put logic in pure modules** (no `$`, no elements) so tests and
  `scripts/preview.ts` can import them. register.ts is wiring only.
- **The sandbox has no DOM and no Node.js** in hooks modules: no `node:*`
  imports, no `process`, no `fs`. Use `$.fs`, `$.clock`, `$.store`, etc.
  (Scripts under `scripts/` are Bun and can use anything.)
- **Read site data from `e.props`** (`hasSurvey`, `isWorking`, `bodyColumns`,
  `maxRows`), not from `e` itself.
- **Yield when there's nothing to draw**: `return next(e)`. In `AbovePrompt`,
  yield while `e.props.hasSurvey` is true.
- **Module variables reset on every hot reload.** `session.start` fires again
  after a reload, so rebuild state there. Use `$.state` for values a drawing
  depends on that must survive a reload (declare them in `types/index.d.ts`
  and point `plugin.json` `types` at it), and `$.store` for values that must
  survive sessions. `/clear`, `/resume`, `/branch` don't fire `session.start`;
  hook `classic.SessionStart` with `{ source: ['clear', 'resume', 'fork'] }`.
- **Resumes** (verified on 2.1.299 with a probe mod): the engine restores a
  resumed session's cost and context itself, exactly; `$.session.usage().cost`
  is per session, not per process. Never persist and re-add them. In-session
  `/resume`, `/clear`, `/branch` raise `session.end`, then
  `classic.SessionStart`, and no `session.start`; the switch lands ~0.5 s
  *after* that hook, so until then `$.session.id()` and `usage()` answer for
  the session being left. Use the hook's `e.session_id`, and re-read usage once
  `$.session.id()` matches it. `claude --resume` raises `classic.SessionStart`
  *before* `session.start`. `context_tokens` adds the last response's output:
  it is not the window's fill.
- **Redraws**: call `$.ui.invalidate('ui.render')` after your data changes. Timers:
  `$.clock.every(ms, fn)` from `session.start`; cancel the previous one first.
  Redraws are throttled (10/s, 30/s for the band in the terminal).
- **Single-width glyphs** in the terminal (`☀ ◑ ↻ █ ▏`). Emoji only if wide by default (`Emoji_Presentation`, no U+FE0F) and counted as two cells; ambiguous ones misalign columns.
- **Draw per surface.** The Desktop app uses a proportional font: never draw bars or
  align with characters/spaces there. Branch on `e.surface` and use `Svg` (Desktop
  only; props `source`, `alt`, `width`, `height`, `isInteractive` — no `key`) for
  icons and bars. SMIL animations play when `isInteractive: true`, so Desktop needs
  no redraw frames. Give gradient/filter ids in an SVG unique values.
- **Colors**: `Text.color` takes a theme key (`'red'`) or a raw color (`'#a8e6a1'`).
- **Hooks have a 10 s budget** (time inside `next` and `$` calls doesn't count).
- A tree with an unknown element or prop is refused and Claude Code draws its
  own; check `claude --debug` / the transcript line `ui.render (...) refused`.
- Every mod must ship tests and pass `claude plugin validate` and
  `claude plugin test`. Stub every `$` call the mod makes (`on('session.usage',
  () => ({ value }))`, `mock.clock(on)` for `$.clock`, a `ui.render` stub when
  the hook can return `next(e)`).

## Where to look things up

The installed version is the authority. Claude Code writes its own types into
`mods/<name>/.claude-plugin/types/` (gitignored) when it loads a mod;
`bun run types:update` copies them into `types/claude-code.d.ts`.

- Overview: https://code.claude.com/docs/en/plugins/mods/overview
- Reference (events, `$` methods, render sites, elements, limits): https://code.claude.com/docs/en/plugins/mods/reference
- Draw in the interface: https://code.claude.com/docs/en/plugins/mods/interface
- React to events: https://code.claude.com/docs/en/plugins/mods/events
- Mods API guide: https://code.claude.com/docs/en/plugins/mods/api
- Testing: https://code.claude.com/docs/en/plugins/mods/test
- Troubleshooting: https://code.claude.com/docs/en/plugins/mods/troubleshoot
- Gallery: https://code.claude.com/docs/en/plugins/mods/gallery
- Built-in mods' source: https://github.com/anthropics/claude-code/tree/main/mods
- Sample mods: https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods
- In a session: `/help mods`

## Conventions

- TypeScript, ES modules, 2-space indent, no semicolons, single quotes.
- Comment density like the existing files: a header comment per file, short
  comments for the non-obvious.
- Mod UI text is in Spanish; code, comments and docs (READMEs included) in English.
- Bump `version` in the mod's `plugin.json` when you change its behavior, so
  `claude plugin marketplace update` picks it up.
