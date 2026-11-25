// Previews usage-hud outside Claude Code, so you can iterate on the design fast.
//
//   bun run preview                  terminal: every scenario, truecolor ANSI
//   bun run preview -- --unicode     …with the unicode icon set
//   bun run preview -- --nerd        …with the Nerd Font icon set (emoji by default)
//   bun run preview -- --card        …in the card style (minimal by default)
//   bun run preview -- --live        terminal, animated: a working turn, then a reset party
//   bun run preview -- --desktop     Desktop: writes an HTML page with the real SVGs and opens it

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mix } from '../mods/usage-hud/hooks/color'
import { barSvg, iconSvg, shakySvg } from '../mods/usage-hud/hooks/icons'
import { applyUsage, celebrate, emptyState, type HudState } from '../mods/usage-hud/hooks/state'
import { fit, minimalSpansOf, type Span, spansOf, widthOf } from '../mods/usage-hud/hooks/terminal'
import { COLORS, DESKTOP_RIGHT, type IconSet, ORDER, SIZES, TERMINAL_RIGHT } from '../mods/usage-hud/hooks/theme'
import { type Item, itemsOf } from '../mods/usage-hud/hooks/view'

const HOUR = 3_600_000
const columns = Math.min(process.stdout.columns ?? 120, 160)
const icons: IconSet = process.argv.includes('--unicode') ? 'unicode' : process.argv.includes('--nerd') ? 'nerd' : 'emoji'

function scenario(
  percent: number,
  fiveUsed: number,
  weekUsed: number,
  usd: number,
  resetIn = 2 * HOUR + 14 * 60_000,
  cacheAgo = 60_000,
): HudState {
  const now = Date.now()
  const s = applyUsage(
    emptyState(),
    {
      context: { tokens: percent * 10_000, window: 1_000_000, percent },
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveUsed, resetsAt: new Date(now + resetIn).toISOString() },
        { kind: 'seven_day', percentUsed: weekUsed, resetsAt: new Date(now + 4 * 24 * HOUR).toISOString() },
      ],
      cost: { usd },
    } as never,
    now,
  )
  const cache = { touchedAt: now - cacheAgo, tokens: percent * 10_000, ttlMs: 5 * 60_000, promptTokens: percent * 10_000, model: 'claude-opus-5-5' }
  return { ...s, cache, turns: Math.max(1, Math.round(percent / 3)) }
}

function partying(): HudState {
  const now = Date.now()
  const s = scenario(30, 99, 50, 2.1, -1)
  return celebrate(s, ['fiveHour'], now)
}

const SCENARIOS: [string, HudState][] = [
  ['fresh', scenario(2, 3, 10, 0.04)],
  ['cruising', scenario(22, 38, 41, 1.23)],
  ['working', { ...scenario(55, 62, 59, 7.8), isWorking: true }],
  ['hot', scenario(76, 84, 77, 18.4, 40 * 60_000, 3.5 * 60_000)],
  ['critical', scenario(93, 95, 92, 64.1, 45_000, 4.5 * 60_000)],
  ['cache cold', scenario(40, 50, 45, 3.2, HOUR, 6 * 60_000)],
  ['reset party', partying()],
]

// ── Terminal ────────────────────────────────────────────────────────────────

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

function ansi(spans: readonly Span[]): string {
  return spans
    .map((s) => {
      if (!s.color && !s.bg) return s.text
      const fg = s.color ? `\x1b[38;2;${rgb(s.color)}m` : ''
      const bg = s.bg ? `\x1b[48;2;${rgb(s.bg)}m` : ''
      return `${s.bold ? '\x1b[1m' : ''}${fg}${bg}${s.text}\x1b[0m`
    })
    .join('')
}

/** The minimal style: one bare row, the session at the left, the limits at the right edge. */
function minimal(state: HudState, now: number): string {
  const rows = fit(
    itemsOf(state, now, ORDER).map((item) => ({ item, spans: minimalSpansOf(item, now, icons) })),
    columns - 2 - SIZES.terminalGap,
  )
  const gap = ' '.repeat(SIZES.terminalGap)
  const side = (list: typeof rows) => ({
    text: list.map((r) => ansi(r.spans)).join(gap),
    width: list.reduce((n, r) => n + widthOf(r.spans), 0) + Math.max(0, list.length - 1) * SIZES.terminalGap,
  })
  const left = side(rows.filter((r) => !TERMINAL_RIGHT.includes(r.item.id)))
  const right = side(rows.filter((r) => TERMINAL_RIGHT.includes(r.item.id)))
  return ` ${left.text}${' '.repeat(Math.max(SIZES.terminalGap, columns - 2 - left.width - right.width))}${right.text}`
}

const isCard = process.argv.includes('--card')
const band = isCard ? (s: HudState, now: number) => card(s, now) : minimal
const bandRows = isCard ? 3 : 1

function card(state: HudState, now: number): string {
  const room = columns - 4
  const rows = fit(
    itemsOf(state, now, ORDER).map((item) => ({ item, spans: spansOf(item, now, icons) })),
    room,
  )
  const gap = ' '.repeat(SIZES.terminalGap)
  const line = rows.map((r) => ansi(r.spans)).join(gap)
  const width = rows.reduce((n, r) => n + widthOf(r.spans), 0) + Math.max(0, rows.length - 1) * SIZES.terminalGap
  const border = (s: string) => ansi([{ text: s, color: COLORS.border }])
  const inner = columns - 2
  return [
    border(`╭${'─'.repeat(inner)}╮`),
    `${border('│')} ${line}${' '.repeat(Math.max(0, inner - 2 - width))} ${border('│')}`,
    border(`╰${'─'.repeat(inner)}╯`),
  ].join('\n')
}

// ── Desktop ─────────────────────────────────────────────────────────────────

function desktopItem(item: Item): string {
  const span = (text: string, color: string, bold = false) =>
    `<span style="color:${color};${bold ? 'font-weight:600' : ''}">${text}</span>`
  const hot = item.id === 'turn' ? COLORS.turnFlash : COLORS.white
  const valueColor = item.glow > 0 ? mix(item.valueColor, hot, item.glow) : item.valueColor
  const parts = [iconSvg(item.id, item.accent, item.mood, SIZES.desktopIcon, item.fill, item.color).source]
  if (item.label) parts.push(span(item.label, COLORS.label))
  if (item.remaining !== undefined) {
    const width = item.id === 'fiveHour' ? SIZES.desktopFiveHourBar : SIZES.desktopWeeklyBar
    parts.push(barSvg(item.remaining, item.color, item.mood, width, SIZES.desktopBarHeight).source)
  }
  if (item.mood === 'party' && item.id === 'countdown') parts.push(shakySvg(item.value, 13).source)
  else parts.push(span(item.value, valueColor, item.glow > 0 || item.mood === 'critical'))
  if (item.detail) parts.push(span(item.detail, COLORS.label))
  return `<div class="item">${parts.join('')}</div>`
}

function desktopRow(state: HudState, now: number): string {
  const items = itemsOf(state, now, ORDER)
  const group = (list: Item[]) => `<div class="group">${list.map(desktopItem).join('')}</div>`
  return group(items.filter((i) => !DESKTOP_RIGHT.includes(i.id))) + group(items.filter((i) => DESKTOP_RIGHT.includes(i.id)))
}

async function desktop() {
  const now = Date.now()
  const rows = SCENARIOS.map(
    ([name, state]) => `<p class="name">${name}</p><div class="band">${desktopRow(state, now)}</div><div class="input">Type / for commands</div>`,
  ).join('')
  const html = `<!doctype html><meta charset="utf-8"><title>usage-hud · desktop preview</title>
<style>
  body { background:#1a1a1a; color:#e8e8e8; font:15px/1.4 -apple-system, system-ui, sans-serif; padding:24px; max-width:1100px }
  .name { color:#777; font-size:12px; margin:22px 0 6px }
  .band { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 28px; background:#242424; border-radius:14px; padding:14px 18px }
  .group { display:flex; align-items:center; gap:28px }
  .item { display:flex; align-items:center; gap:8px }
  .input { margin-top:8px; border:1px solid #444; border-radius:14px; padding:12px 18px; color:#777 }
</style>${rows}`
  const file = join(tmpdir(), 'usage-hud-desktop-preview.html')
  await Bun.write(file, html)
  console.log(file)
  if (!process.argv.includes('--no-open')) Bun.spawn(['open', file])
}

// ── Main ────────────────────────────────────────────────────────────────────

if (process.argv.includes('--desktop')) {
  await desktop()
} else if (process.argv.includes('--live')) {
  const start = Date.now()
  let s: HudState = { ...scenario(48, 97, 60, 3.4, 4_000), isWorking: true }
  process.stdout.write(`\x1b[?25l${'\n'.repeat(bandRows)}`)
  process.on('SIGINT', () => {
    process.stdout.write('\x1b[?25h\n')
    process.exit(0)
  })
  setInterval(() => {
    const now = Date.now()
    if (now - start > 2_500 && s.isWorking) {
      s = { ...s, isWorking: false, turns: s.turns + 1, effects: { ...s.effects, turnFlashUntil: now + 1_500 } }
    }
    const resetsAt = s.limits.fiveHour?.resetsAt
    if (resetsAt !== undefined && now >= resetsAt && !s.effects.celebrateUntil.fiveHour) s = celebrate(s, ['fiveHour'], now)
    process.stdout.write(`\x1b[${bandRows}A\r\x1b[J${band(s, now)}\n`)
  }, 100)
} else {
  const now = Date.now()
  for (const [name, state] of SCENARIOS) {
    console.log(`\x1b[2m${name}\x1b[0m`)
    console.log(band(state, now))
  }
}
