// Everything you'd tweak to restyle the HUD: palette, gradients, glyphs,
// sizes, labels, timings and the order of the segments.

import type { Stop } from './color'

export type SegmentId = 'turn' | 'context' | 'cache' | 'fiveHour' | 'countdown' | 'weekly' | 'cost'

/** Left to right as drawn. */
export const ORDER: readonly SegmentId[] = ['turn', 'context', 'cache', 'fiveHour', 'countdown', 'weekly', 'cost']

/** What survives first when the band is too narrow: earlier = kept longer. */
export const PRIORITY: readonly SegmentId[] = ['turn', 'context', 'cache', 'fiveHour', 'countdown', 'cost', 'weekly']

export const ALIGN: 'left' | 'right' = 'left'

export const LABELS = {
  turn: 'Turno',
  cache: 'caché',
  cacheCold: 'fría',
  /** No cache yet: a fresh session or a /clear before its first response. */
  cacheNone: '—',
  cacheToast: (minutes: number) => `✦ Tu caché expira en ${minutes === 1 ? '1 minuto' : `${minutes} minutos`}`,
  fiveHour: '5h',
  weekly: '7d',
  reset: '¡RESET!',
  ready: 'listo',
  toastFiveHour: '✦ Tu límite de 5 horas se reseteó',
  toastWeekly: '✦ Tu límite semanal se reseteó',
  /** The 5-hour window's pace, percent per hour. */
  pace: (percentPerHour: number) => `${percentPerHour}%/h`,
  /** At this pace the 5-hour window runs out before it resets, at this hour. */
  paceRunsOut: (time: string) => `se agota ${time}`,
  /** What the next prompt pays to re-cache the conversation. */
  recache: (usd: string) => `recalentar ${usd}`,
}

/**
 * Terminal icons per segment. `nerd` needs a Nerd Font; `unicode` works
 * everywhere; `emoji` is bigger, two cells each: only emoji that are wide by
 * default (Emoji_Presentation, no U+FE0F), so every terminal agrees on the width.
 */
export const TERMINAL_ICONS = {
  nerd: {
    turn: '\uf086', // nf-fa-comments
    context: '\u{f09d1}', // nf-md-brain
    cache: '\uf1c0', // nf-fa-database
    fiveHour: '\uf0e7', // nf-fa-bolt
    countdown: '\uf252', // nf-fa-hourglass_half
    weekly: '\uf073', // nf-fa-calendar
    cost: '\uf155', // nf-fa-dollar
  },
  unicode: {
    turn: '◆',
    context: '◑',
    cache: '≋',
    fiveHour: 'ϟ',
    countdown: '↻',
    weekly: '◷',
    cost: '$',
  },
  emoji: {
    turn: '💬',
    context: '🧠',
    cache: '🧊',
    fiveHour: '🔋',
    countdown: '⏳',
    weekly: '📅',
    cost: '💰',
  },
} as const

export type IconSet = keyof typeof TERMINAL_ICONS

export const GLYPHS = {
  countdown: '↻',
  costUp: '▲',
  /** Context fill in the unicode set, from empty to full. */
  pie: ['○', '◔', '◑', '◕', '●'],
  /** Terminal bars: a thin line, the fill heavy, a half cell for precision, the rest light. */
  barFull: '━',
  barHalf: '╸',
  barEmpty: '─',
  /** The minimal style's meter: one block per tenth. */
  meterFull: '▰',
  meterEmpty: '▱',
}

/** Minimal terminal style: these go to the right edge of the band, the rest stay at the left. */
export const TERMINAL_RIGHT: readonly SegmentId[] = ['fiveHour', 'countdown', 'weekly', 'cost']

/** Desktop: these go to the right edge of the row, the rest stay at the left. */
export const DESKTOP_RIGHT: readonly SegmentId[] = ['fiveHour', 'weekly']

export const SIZES = {
  /** The minimal style's meters, in cells (one per tenth). */
  meter: 10,
  /** Terminal bars, in cells. */
  fiveHourBar: 12,
  weeklyBar: 8,
  /** Cells between items in the terminal. */
  terminalGap: 2,
  /** Desktop, in CSS pixels. */
  desktopIcon: 22,
  desktopFiveHourBar: 96,
  desktopWeeklyBar: 72,
  desktopBarHeight: 6,
}

/** A muted palette for a dark background: neutral text, soft accents. */
export const COLORS = {
  /** Values, the main text */
  value: '#d4d4d4',
  /** Labels and details */
  label: '#7d7d7d',
  border: '#3a3a3a',
  /** A bar's empty part */
  track: '#3a3a3a',
  /** What a terminal icon's badge is tinted toward: the card's background. */
  badgeBase: '#202020',
  turnFlash: '#e8d58a',
  white: '#ffffff',
  /** The pace when the 5-hour window would run out before its reset. */
  paceWarn: '#cc8a5c',
}

/** Each segment's own icon color: tells them apart, never shouts. */
export const ACCENTS: Record<SegmentId, string> = {
  turn: '#8e88d8',
  context: '#7a9cc6',
  cache: '#b48ead',
  fiveHour: '#c8a35f',
  countdown: '#56b0a6',
  weekly: '#8f9bb3',
  cost: '#6aae78',
}

/** The countdown's accent brightens toward this in its last hour. */
export const COUNTDOWN_NEAR = '#7fd1c4'

/** Muted traffic light by percent of the context window used. */
export const CONTEXT_STOPS: readonly Stop[] = [
  [0, '#6aae78'],
  [40, '#9fb565'],
  [60, '#c8a35f'],
  [80, '#cc8a5c'],
  [100, '#c96b6b'],
]

/**
 * The cache's alerts: from each of these minutes left, its value takes the
 * color, shakes for a moment and a toast says so. Above the first, neutral.
 */
export const CACHE_ALERTS: readonly { minutes: number; color: string }[] = [
  { minutes: 15, color: '#e8d58a' },
  { minutes: 10, color: '#c8a35f' },
  { minutes: 5, color: '#cc8a5c' },
  { minutes: 1, color: '#c96b6b' },
]

/** Muted traffic light by percent of a rate limit still available. */
export const REMAINING_STOPS: readonly Stop[] = [
  [0, '#c96b6b'],
  [20, '#cc8a5c'],
  [40, '#c8a35f'],
  [60, '#9fb565'],
  [100, '#6aae78'],
]

/** By log10 of the session's cost in dollars: green to $3, then amber, orange, red past $50. */
export const COST_STOPS: readonly Stop[] = [
  [-1, '#6aae78'],
  [0.5, '#6aae78'],
  [1, '#c8a35f'],
  [1.4, '#cc8a5c'],
  [1.7, '#c96b6b'],
]

export const TIMING = {
  /** How long a reset celebrates, rainbow and shake. */
  celebrateMs: 6000,
  /** The turn number glows after a turn ends. */
  turnFlashMs: 1500,
  /** The cache's value shakes this long when it crosses an alert. */
  cacheShakeMs: 3000,
  /** The cost glows after it grows. */
  costFlashMs: 2000,
  /** The ended turn's cost shows beside the total this long. */
  turnCostMs: 3000,
  /** Pulse period while Claude works on the turn. */
  workingPulseMs: 1400,
  /** Pulse period for critical levels (context or limit nearly gone). */
  criticalPulseMs: 900,
  /** Animation frame while something animates. */
  frameMs: 100,
}

export const THRESHOLDS = {
  /** Context percent used from which it pulses. */
  contextCritical: 90,
  /** Rate limit percent remaining under which it pulses. */
  limitCritical: 10,
  /** Countdown under which it turns mint, and under which it pulses. */
  countdownNearMs: 60 * 60_000,
  countdownFinalMs: 60_000,
  /** Cache TTL left under which its countdown pulses. */
  cacheFinalMs: 60_000,
  /** Minimal style: the weekly reset date shows once what's left falls to this percent. */
  weeklyDateBelow: 30,
  /** Cost under which its value stays neutral, in dollars. */
  costQuietUsd: 3,
  /** The re-cache cost shows under this much TTL left, or this share of the TTL if less (2 min of a 5-minute cache), and once it's cold. */
  recacheShowMs: 5 * 60_000,
  recacheShowShare: 0.4,
}
