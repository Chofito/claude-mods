// Draws the items in the terminal: a rounded card of colored text, Nerd Font
// (or plain unicode, or emoji) icons, block-character bars, and animations
// made of frames: the hook re-runs every TIMING.frameMs while something moves.
// The `minimal` style drops the badges and the border: bare icons, ▰▱ meters,
// the session at the left and the limits at the right edge.

import { mix, rainbow, wave } from './color'
import { ALIGN, COLORS, GLYPHS, type IconSet, PRIORITY, SIZES, TERMINAL_ICONS, TERMINAL_RIGHT, THRESHOLDS, TIMING } from './theme'
import type { Item } from './view'

export type Span = { text: string; color?: string; bg?: string; bold?: boolean }

export type TerminalStyle = 'minimal' | 'card' | 'line'

const WIDE = /\p{Emoji_Presentation}/u

/** Width in cells: one per glyph, two for the emoji icons. */
export function widthOf(spans: readonly Span[]): number {
  return spans.reduce((n, s) => n + [...s.text].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0), 0)
}

function rainbowSpans(text: string, now: number, offset = 0, bold = true): Span[] {
  return [...text].map((ch, i) => ({ text: ch, color: rainbow(i + offset, now), bold }))
}

/** Rainbow text that jitters a cell left and right inside a fixed width. */
function shaky(text: string, now: number): Span[] {
  const pad = [1, 0, 2, 1, 2, 0, 1][Math.floor(now / TIMING.frameMs) % 7]!
  return [{ text: ' '.repeat(pad) }, ...rainbowSpans(text, now), { text: ' '.repeat(2 - pad) }]
}

/** Text that jitters a cell left and right inside a fixed width, in its own color. */
function jitter(text: string, color: string, now: number): Span[] {
  const pad = [1, 0, 2, 1, 2, 0, 1][Math.floor(now / TIMING.frameMs) % 7]!
  return [{ text: ' '.repeat(pad) }, { text, color, bold: true }, { text: ' '.repeat(2 - pad) }]
}

/**
 * What's left of a limit as a thin line: heavy where there's budget, light
 * where it's used, emptying toward the left, with half-cell precision.
 */
export function bar(remaining: number, width: number, color: string): Span[] {
  const halves = Math.round((Math.max(0, Math.min(100, remaining)) / 100) * width * 2)
  const full = Math.floor(halves / 2)
  const half = halves % 2 === 1
  const spans: Span[] = []
  if (full > 0) spans.push({ text: GLYPHS.barFull.repeat(full), color })
  if (half) spans.push({ text: GLYPHS.barHalf, color })
  const rest = width - full - (half ? 1 : 0)
  if (rest > 0) spans.push({ text: GLYPHS.barEmpty.repeat(rest), color: COLORS.track })
  return spans
}

/** Breathes `base` toward white by the mood: slow while working, fast when critical. */
function pulsed(base: string, item: Item, now: number): string {
  switch (item.mood) {
    case 'working':
      return mix(base, COLORS.white, wave(now, TIMING.workingPulseMs) * 0.35)
    case 'critical':
      return mix(base, COLORS.white, wave(now, TIMING.criticalPulseMs) * 0.35)
    case 'final':
      return mix(base, COLORS.white, wave(now, 1000) * 0.5)
    default:
      return base
  }
}

/** The value's color at this frame: its afterglow, then its pulse. */
function valueColorAt(item: Item, now: number): string {
  const hot = item.id === 'turn' ? COLORS.turnFlash : COLORS.white
  const base = item.glow > 0 ? mix(item.valueColor, hot, item.glow) : item.valueColor
  return item.mood === 'working' ? base : pulsed(base, item, now)
}

function iconOf(item: Item, icons: IconSet): string {
  if (icons === 'unicode' && item.id === 'context' && item.fill !== undefined) {
    const pie = GLYPHS.pie
    return pie[Math.min(pie.length - 1, Math.round((item.fill / 100) * (pie.length - 1)))]!
  }
  return TERMINAL_ICONS[icons][item.id]
}

export function spansOf(item: Item, now: number, icons: IconSet): Span[] {
  const party = item.mood === 'party'
  const accent = party ? rainbow(0, now) : pulsed(item.accent, item, now)
  // The icon sits in a badge tinted with its own accent, so a one-cell glyph still reads
  // (an emoji keeps its own colors; the badge still tints behind it).
  const spans: Span[] = [{ text: ` ${iconOf(item, icons)} `, color: accent, bg: mix(item.accent, COLORS.badgeBase, 0.8) }, { text: ' ' }]
  if (item.label) spans.push({ text: `${item.label} `, color: COLORS.label })
  if (item.remaining !== undefined) {
    const width = item.id === 'fiveHour' ? SIZES.fiveHourBar : SIZES.weeklyBar
    spans.push(...(party ? rainbowSpans(GLYPHS.barFull.repeat(width), now, 0, false) : bar(item.remaining, width, pulsed(item.color, item, now))))
    spans.push({ text: ' ' })
  }
  if (party && item.id === 'countdown') spans.push(...shaky(item.value, now))
  else if (party) spans.push(...rainbowSpans(item.value, now, 3))
  else if (item.isShaking) spans.push(...jitter(item.value, valueColorAt(item, now), now))
  else spans.push({ text: item.value, color: valueColorAt(item, now), bold: item.glow > 0 || item.mood === 'critical' || item.mood === 'final' })
  if (item.id === 'cost' && item.glow > 0 && !item.extras) spans.push({ text: ` ${GLYPHS.costUp}`, color: valueColorAt(item, now) })
  if (item.detail) spans.push({ text: ` ${item.detail}`, color: COLORS.label })
  return [...spans, ...extraSpans(item)]
}

function extraSpans(item: Item): Span[] {
  return (item.extras ?? []).map((x) => ({ text: ` ${x.text}`, color: x.color }))
}

/** What's left of a limit as ▰▱ blocks, one per tenth, rounded up so a sliver still shows. */
export function meter(remaining: number, width: number, color: string): Span[] {
  const pct = Math.max(0, Math.min(100, remaining))
  const full = pct === 0 ? 0 : Math.max(1, Math.round((pct / 100) * width))
  const spans: Span[] = []
  if (full > 0) spans.push({ text: GLYPHS.meterFull.repeat(full), color })
  if (width - full > 0) spans.push({ text: GLYPHS.meterEmpty.repeat(width - full), color: COLORS.track })
  return spans
}

/**
 * One item in the minimal style: a bare icon in its accent, the value, and
 * only the labels a number needs to be read (`5h`, `7d`). The weekly date
 * shows only once that window runs low.
 */
export function minimalSpansOf(item: Item, now: number, icons: IconSet): Span[] {
  const party = item.mood === 'party'
  const accent = party ? rainbow(0, now) : pulsed(item.accent, item, now)
  const spans: Span[] = [{ text: `${iconOf(item, icons)} `, color: accent }]
  if (item.id === 'fiveHour' || item.id === 'weekly') spans.push({ text: `${item.label} `, color: COLORS.label })
  if (item.remaining !== undefined) {
    spans.push(...(party ? rainbowSpans(GLYPHS.meterFull.repeat(SIZES.meter), now, 0, false) : meter(item.remaining, SIZES.meter, pulsed(item.color, item, now))))
    spans.push({ text: ' ' })
  }
  const value = item.id === 'countdown' && !party ? item.value.replace(' ', '') : item.value
  if (party) spans.push(...rainbowSpans(value, now, 3))
  else if (item.isShaking) spans.push(...jitter(value, valueColorAt(item, now), now))
  else spans.push({ text: value, color: valueColorAt(item, now), bold: item.glow > 0 || item.mood === 'critical' || item.mood === 'final' })
  if (item.id === 'cost' && item.glow > 0 && !item.extras) spans.push({ text: ` ${GLYPHS.costUp}`, color: valueColorAt(item, now) })
  if (item.detail && (item.remaining ?? 100) <= THRESHOLDS.weeklyDateBelow) spans.push({ text: ` ${item.detail}`, color: COLORS.label })
  return [...spans, ...extraSpans(item)]
}

/** Drops the least important items until the row fits in `room` cells. */
export function fit(rows: { item: Item; spans: Span[] }[], room: number): { item: Item; spans: Span[] }[] {
  const total = (list: typeof rows) =>
    list.reduce((n, r) => n + widthOf(r.spans), 0) + Math.max(0, list.length - 1) * SIZES.terminalGap
  let kept = rows
  for (const id of [...PRIORITY].reverse()) {
    if (total(kept) <= room) break
    kept = kept.filter((r) => r.item.id !== id)
  }
  return kept
}

/** Adjacent spans with the same style merge into one Text, to keep the tree small. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const last = out[out.length - 1]
    if (last && last.color === span.color && last.bg === span.bg && !!last.bold === !!span.bold) last.text += span.text
    else out.push({ ...span })
  }
  return out
}

type Factory = (props: Record<string, unknown>) => unknown

export type TerminalOptions = { icons: IconSet; style: TerminalStyle; columns: number; maxRows: number }

function rowOf(Box: Factory, Text: Factory, item: Item, spans: readonly Span[]): unknown {
  return Box({
    key: item.id,
    flexDirection: 'row',
    children: merged(spans).map((s) => {
      const props: Record<string, unknown> = { children: s.text }
      if (s.color) props.color = s.color
      if (s.bg) props.backgroundColor = s.bg
      if (s.bold) props.bold = true
      return Text(props)
    }),
  })
}

/** The minimal band: one bare row, the session at the left, the limits and cost at the right. */
function drawMinimal(Box: Factory, Text: Factory, items: readonly Item[], now: number, opts: TerminalOptions): unknown {
  // Two cells of padding, and at least one gap's worth between the groups.
  const rows = fit(
    items.map((item) => ({ item, spans: minimalSpansOf(item, now, opts.icons) })),
    opts.columns - 2 - SIZES.terminalGap,
  )
  if (rows.length === 0) return undefined
  const group = (list: typeof rows) =>
    Box({ flexDirection: 'row', columnGap: SIZES.terminalGap, children: list.map(({ item, spans }) => rowOf(Box, Text, item, spans)) })
  const left = rows.filter((r) => !TERMINAL_RIGHT.includes(r.item.id))
  const right = rows.filter((r) => TERMINAL_RIGHT.includes(r.item.id))
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: SIZES.terminalGap,
    paddingX: 1,
    children: [left, right].filter((g) => g.length > 0).map(group),
  })
}

/** The whole band, or undefined when nothing fits. */
export function drawTerminal(Box: Factory, Text: Factory, items: readonly Item[], now: number, opts: TerminalOptions): unknown {
  if (opts.style === 'minimal') return drawMinimal(Box, Text, items, now, opts)
  // A card needs a row above and below; fall back to a bare line where there's no room.
  const isCard = opts.style === 'card' && opts.maxRows >= 3
  const room = opts.columns - (isCard ? 4 : 2)
  const rows = fit(
    items.map((item) => ({ item, spans: spansOf(item, now, opts.icons) })),
    room,
  )
  if (rows.length === 0) return undefined
  const children = rows.map(({ item, spans }) => rowOf(Box, Text, item, spans))
  const row: Record<string, unknown> = {
    flexDirection: 'row',
    justifyContent: ALIGN === 'right' ? 'flex-end' : 'flex-start',
    columnGap: SIZES.terminalGap,
    paddingX: 1,
    children,
  }
  if (isCard) Object.assign(row, { borderStyle: 'round', borderColor: COLORS.border })
  return Box(row)
}
