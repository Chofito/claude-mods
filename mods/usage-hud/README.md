# usage-hud

A bar right above the Claude Code prompt with your live usage, drawn natively for each
surface: SVG icons and bars in the Desktop app, a rounded card with Nerd Font icons in the
terminal. Left to right:

**Desktop** — one row: ring icons and counters at the left, the limit bars at the right
edge, animations in the SVGs themselves:

```
(◌) Turno 7  (◔) 221k/1M  (≋) 57:12  (⧗) 2h 14m  ($) $1.23                 (ϟ) 5h ━━━━━━──── 62%  (▦) 7d ━━━━─── 59% 12/10 6pm
```

**Terminal** — one bare row by default (`minimal`): the session at the left, the limits
and cost at the right edge, `▰▱` meters, values in neutral grey that take a color only when
they need your attention:

```
 💬 7  🧠 220k/1M  🧊 57:12                    🔋 5h ▰▰▰▰▰▰▱▱▱▱ 62%  ⏳ 2h14m  📅 7d ▰▰▰▰▰▰▱▱▱▱ 59%  💰 $1.23
```

The `card` style draws the older rounded box, each icon in a badge tinted with its color
(`line` drops the border).

Colors are muted for a dark background: values in neutral grey, each segment's icon in its
own soft accent, and the traffic light (green → olive → amber → orange → red) only on the
bars, the context gauge, and on values that need your attention.

| Segment | Shows | Effects |
| :- | :- | :- |
| **Turno N** | Messages you've sent this session (turn 2 = your second message and its answer) | Pulses while Claude works; glows yellow when the turn ends, then fades |
| **Context** `221k/1M` | Tokens in context / the model's window. On Desktop the icon is a gauge ring that fills | Traffic light on the gauge; the value turns red and pulses from 90 % |
| **caché** `57:12` | Time until the prompt cache expires: each main-loop response restarts its TTL (1 h on a subscription within its plan, 5 min otherwise). `fría` once it expired, so the next prompt writes the whole context to the cache again. In the last minutes (5 of a 1-hour cache, 2 of a 5-minute one) and once cold, `recalentar ~$1.61`: what that write costs at API list price (`hooks/pricing.ts`) | Neutral above 15 min. At 15, 10, 5 and 1 min left it turns yellow → amber → orange → red, shakes for a moment and a toast says so (once each; a response restarts them). A `mm:ss` clock; pulses in the last minute; grey when cold; `—` before the first response |
| **5h** | What's **left** of the 5-hour limit; the bar empties right to left. Then your pace, `14%/h` (used since the window opened); if that pace runs it out before the reset, `se agota 4:50pm` in orange instead | Same traffic light by what's left. Pulses at ≤10 % |
| **Countdown** `2h 14m` | Time until the 5-hour limit resets (seconds within the last hour) | Grey when far, mint in the last hour; in the last minute it pulses and (Desktop) the hourglass flips. **On reset:** shaky rainbow `¡RESET!`, rainbow bar, a toast |
| **7d** | What's left of the weekly limit and when it resets (day/month time) | Like the 5-hour one, with its own reset party |
| **Cost** `$1.23` | The session's total cost (same as `/cost`: Claude Code's estimate at API prices, even on a subscription). For 3 s after a turn ends, its own cost beside it: `$1.55 (+$0.32)` | Colored by magnitude (log scale). Glows when it grows |

In a narrow terminal, segments hide in this order: weekly, cost, countdown, 5h, cache, context (the
turn always stays). Without a subscription (API key), the limit segments don't show.

## Options

In `/config` (or `pluginConfigs` in settings):

| Option | Values | Default |
| :- | :- | :- |
| `terminal_icons` | `emoji` (bigger, colored, two cells each) · `nerd` (needs a Nerd Font; a non-*Mono* Nerd Font draws them bigger) · `unicode` | `emoji` |
| `terminal_style` | `minimal` (one bare row, `▰▱` meters) · `card` (rounded box with icon badges, 3 rows) · `line` (the card's row, no box) | `minimal` |
| `cache_ttl` | `auto` · `5m` · `1h`: the main conversation's prompt cache TTL. `auto` follows [Claude Code's defaults](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets): 1 h on a subscription within its plan, 5 min on usage credits, an API key or a cloud provider. Set it by hand if you changed `promptCacheTtl`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H` or `FORCE_PROMPT_CACHING_5M`, which a mod can't read. A `/model` switch reports the real TTL and the HUD adopts it for the session. When the API reports the TTL a response wrote the cache with, that wins over every guess. Before the first rate-limit reading (a fresh process's first response) `auto` shows 5 min and settles on 1 h once a reading names a window; on a resume, Claude Code's `prompt_cache_likely_expired` pins it when only one TTL fits | `auto` |

## Customize

Everything visual lives in [`hooks/theme.ts`](hooks/theme.ts): segment order (`ORDER`),
alignment (`ALIGN`), what hides first (`PRIORITY`), UI text (`LABELS`), terminal icons,
bar sizes, palettes/gradients, animation timings and thresholds. The Desktop icons are
hand-drawn SVG in [`hooks/icons.ts`](hooks/icons.ts).

Try changes before opening Claude Code:

```sh
bun run preview                 # terminal, every scenario
bun run preview -- --live       # terminal, animated
bun run preview -- --nerd       # terminal, Nerd Font icons
bun run preview -- --card       # terminal, card style
bun run preview -- --desktop    # Desktop: opens an HTML page with the real SVGs
```

## How it works

- `register.ts` — the hooks:
  - `session.start`: reads `$.session.usage()` and `$.session.turns()`, starts a 100 ms timer
  - `session.measure`: Claude Code pushes context, limits and cost after each turn and whenever a limit moves a point
  - `turn.start` / `turn.complete`: the *working* state, turn number and flash, and the turn's own cost (the total's growth between them)
  - `turn.step`: each main-loop response whose usage read or wrote the prompt cache restarts the cache countdown, with the TTL the API reports it wrote (`ephemeral_1h/5m_input_tokens`) when it does; it also keeps the prompt's size and model to price a re-cache (subagents' responses don't count: their cache is another prefix)
  - `classic.PostModelSwitch` and `classic.SessionStart` gate the session, so each has a `.catch` that lets it go on if the HUD fails
  - `classic.PostModelSwitch`: adopts the session's real cache TTL and marks the cache cold (the new model has none)
  - `classic.SessionStart` (`/clear`, `/resume`, `/branch`): starts the new session's state from the hook's `session_id`, restarts the cache countdown from `seconds_since_last_response`, and re-reads the engine's figures once the switch lands (until then `$.session.id()` and `usage()` still answer for the session left). A `claude --resume` raises it *before* `session.start`, which keeps what it set up
  - `session.end`: saves the cache countdown and stops saving until the next session starts, so nothing lands under the session being left
  - `ui.render` on `AbovePrompt`: draws the bar with the renderer for `e.surface`
  - A 100 ms timer starts celebrations when a reset time passes and redraws when the countdown's second changes; it runs frame animations only while a terminal is drawing (Desktop animates inside its SVGs)
- `persist.ts` — what's kept per session in `$.store` (one key each, the 30 most recent): only the cache countdown, so a hot reload or a restart picks it up. Cost and context are never kept: on a resume Claude Code restores both itself, exactly, and the HUD reads them from it
- `state.ts` — folds the engine's figures; decides resets and celebrations (each reset celebrates once; one that passed before the session opened doesn't), the 5-hour pace and the turn's cost
- `pricing.ts` — API list prices per model, to price a re-cache (the session's cost is always Claude Code's own)
- `view.ts` — the surface-neutral items: text, color and mood (`calm`, `working`, `critical`, `final`, `party`) of each segment
- `terminal.ts` — items → colored spans, frame animations, fit to width, the rounded card
- `desktop.ts` + `icons.ts` — items → `Svg` icons and bars (SMIL animations) and `Text`
- `color.ts`, `format.ts` — pure utilities

Note: the cache countdown is an estimate kept locally from the time of the last response;
the API can evict a cache earlier. Limits come from the last API response. If you're idle when the reset time arrives, the
bar assumes the reset (100 %) until the next response.

```sh
bun run dev usage-hud
claude plugin test mods/usage-hud
```
