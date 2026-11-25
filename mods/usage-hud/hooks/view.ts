// The HUD as a surface-neutral list of items: what each segment says, its
// color and its mood. terminal.ts and desktop.ts each draw these their own
// way. Pure: state and time in, items out.

import { gradient, mix } from './color'
import * as Format from './format'
import { cacheWriteUsd } from './pricing'
import { cacheLeft, effectiveLimit, fiveHourPace, type HudState, isCelebrating, type LimitKind, shownTurnCost, totalCost } from './state'
import {
  ACCENTS,
  CACHE_ALERTS,
  COLORS,
  CONTEXT_STOPS,
  COST_STOPS,
  COUNTDOWN_NEAR,
  LABELS,
  REMAINING_STOPS,
  type SegmentId,
  THRESHOLDS,
  TIMING,
} from './theme'

/**
 * How an item moves:
 * - `calm`: still
 * - `working`: a slow pulse while Claude works
 * - `critical`: a fast pulse, the level is nearly gone
 * - `final`: the countdown's last minute
 * - `party`: a reset just happened, rainbow and shake
 */
export type Mood = 'calm' | 'working' | 'critical' | 'final' | 'party'

export type Item = {
  id: SegmentId
  /** The icon's color: the segment's own accent. */
  accent: string
  /** The state's color (traffic light) for bars and the context gauge. */
  color: string
  /** The value's color: neutral, unless the value itself is the signal. */
  valueColor: string
  mood: Mood
  /** 0..1: how much of an afterglow (turn just ended, cost just grew) is left. */
  glow: number
  /** Dim text before the value: `Turno`, `5h`, `7d`. */
  label?: string
  value: string
  /** Dim text after the value: the weekly reset date. */
  detail?: string
  /** What's left of a limit, 0..100, drawn as a bar. */
  remaining?: number
  /** The context window's fill, 0..100, drawn as the gauge icon. */
  fill?: number
  /** The value jitters: the cache just crossed an alert. */
  isShaking?: boolean
  /** Short notes after the value, shown on every style and surface: the pace, a re-cache's cost, the turn's cost. */
  extras?: Extra[]
}

export type Extra = { text: string; color: string }

function afterglow(until: number, durationMs: number, now: number): number {
  return until > now ? (until - now) / durationMs : 0
}

function turn(state: HudState, now: number): Item {
  return {
    id: 'turn',
    accent: ACCENTS.turn,
    color: ACCENTS.turn,
    valueColor: COLORS.value,
    mood: state.isWorking ? 'working' : 'calm',
    glow: state.isWorking ? 0 : afterglow(state.effects.turnFlashUntil, TIMING.turnFlashMs, now),
    label: LABELS.turn,
    value: String(state.turns),
  }
}

export function isContextCritical(state: HudState): boolean {
  return (state.context?.percent ?? 0) >= THRESHOLDS.contextCritical
}

function context(state: HudState): Item | undefined {
  const ctx = state.context
  if (!ctx) return undefined
  const color = gradient(CONTEXT_STOPS, ctx.percent)
  const critical = isContextCritical(state)
  return {
    id: 'context',
    accent: ACCENTS.context,
    color,
    valueColor: critical ? color : COLORS.value,
    mood: critical ? 'critical' : 'calm',
    glow: 0,
    value: `${Format.tokens(ctx.tokens)}/${Format.tokens(ctx.window)}`,
    fill: ctx.percent,
  }
}

/**
 * Time left on the prompt cache, colored by how much of its TTL is left;
 * `fría` once it expired: the next prompt writes the whole context again.
 */
function cache(state: HudState, now: number): Item | undefined {
  const left = cacheLeft(state, now)
  if (left === undefined) {
    return { id: 'cache', accent: ACCENTS.cache, color: COLORS.label, valueColor: COLORS.label, mood: 'calm', glow: 0, label: LABELS.cache, value: LABELS.cacheNone }
  }
  const recache = recacheExtra(state, left)
  if (left <= 0) {
    const item: Item = { id: 'cache', accent: COLORS.label, color: COLORS.label, valueColor: COLORS.label, mood: 'calm', glow: 0, label: LABELS.cache, value: LABELS.cacheCold }
    if (recache) item.extras = [recache]
    return item
  }
  // The color of the lowest alert it's under (15, 10, 5, 1 minutes), neutral above them.
  const alert = [...CACHE_ALERTS].reverse().find((a) => left <= a.minutes * 60_000)
  const color = alert?.color ?? COLORS.value
  const final = left <= THRESHOLDS.cacheFinalMs
  const shaking = state.effects.cacheShakeUntil > now
  const item: Item = {
    id: 'cache',
    accent: alert ? color : ACCENTS.cache,
    color,
    valueColor: color,
    mood: final ? 'final' : shaking ? 'critical' : 'calm',
    glow: 0,
    label: LABELS.cache,
    value: Format.clock(left),
    isShaking: shaking,
  }
  if (recache) item.extras = [{ ...recache, color }]
  return item
}

/**
 * What the next prompt pays to write the conversation to the cache again,
 * at list price: only once the cache is nearly out (or out), and only for a
 * model the price table knows.
 */
function recacheExtra(state: HudState, left: number): Extra | undefined {
  const cache = state.cache
  if (!cache || cache.promptTokens === undefined) return undefined
  if (left > Math.min(THRESHOLDS.recacheShowMs, cache.ttlMs * THRESHOLDS.recacheShowShare)) return undefined
  const usd = cacheWriteUsd(cache.model, cache.promptTokens, cache.ttlMs)
  return usd === undefined ? undefined : { text: LABELS.recache(Format.approxMoney(usd)), color: COLORS.label }
}

/** True in the cache's last minute: its countdown pulses. */
export function isCacheFinal(state: HudState, now: number): boolean {
  const left = cacheLeft(state, now)
  return left !== undefined && left > 0 && left <= THRESHOLDS.cacheFinalMs
}

export function isLimitCritical(state: HudState, kind: LimitKind, now: number): boolean {
  const limit = effectiveLimit(state.limits[kind], now)
  return !!limit && 100 - limit.percentUsed <= THRESHOLDS.limitCritical
}

function limit(state: HudState, kind: LimitKind, now: number): Item | undefined {
  const lim = effectiveLimit(state.limits[kind], now)
  if (!lim) return undefined
  const party = isCelebrating(state, kind, now)
  const remaining = party ? 100 : 100 - lim.percentUsed
  const color = gradient(REMAINING_STOPS, remaining)
  const critical = !party && isLimitCritical(state, kind, now)
  const item: Item = {
    id: kind,
    accent: ACCENTS[kind],
    color,
    valueColor: critical ? color : COLORS.value,
    mood: party ? 'party' : critical ? 'critical' : 'calm',
    glow: 0,
    label: kind === 'fiveHour' ? LABELS.fiveHour : LABELS.weekly,
    value: `${Math.round(remaining)}%`,
    remaining,
  }
  const resetsAt = state.limits[kind]?.resetsAt
  if (kind === 'weekly' && !party && resetsAt !== undefined && resetsAt > now) item.detail = Format.resetDate(resetsAt)
  if (kind === 'fiveHour' && !party) {
    const pace = fiveHourPace(state, now)
    if (pace?.runsOutAt !== undefined) item.extras = [{ text: LABELS.paceRunsOut(Format.timeOfDay(pace.runsOutAt)), color: COLORS.paceWarn }]
    else if (pace) item.extras = [{ text: LABELS.pace(Math.round(pace.percentPerHour)), color: COLORS.label }]
  }
  return item
}

function countdown(state: HudState, now: number): Item | undefined {
  const raw = state.limits.fiveHour
  if (!raw) return undefined
  if (isCelebrating(state, 'fiveHour', now)) {
    return { id: 'countdown', accent: COUNTDOWN_NEAR, color: COUNTDOWN_NEAR, valueColor: COUNTDOWN_NEAR, mood: 'party', glow: 0, value: LABELS.reset }
  }
  if (raw.resetsAt === undefined) return undefined
  const left = raw.resetsAt - now
  if (left <= 0) {
    return { id: 'countdown', accent: COUNTDOWN_NEAR, color: COUNTDOWN_NEAR, valueColor: COUNTDOWN_NEAR, mood: 'calm', glow: 0, value: LABELS.ready }
  }
  const near = left <= THRESHOLDS.countdownNearMs
  const accent = near ? mix(ACCENTS.countdown, COUNTDOWN_NEAR, 1 - left / THRESHOLDS.countdownNearMs) : ACCENTS.countdown
  return {
    id: 'countdown',
    accent,
    color: accent,
    valueColor: left <= THRESHOLDS.countdownFinalMs ? accent : COLORS.value,
    mood: left <= THRESHOLDS.countdownFinalMs ? 'final' : 'calm',
    glow: 0,
    value: Format.countdown(left),
  }
}

function cost(state: HudState, now: number): Item | undefined {
  const usd = totalCost(state)
  if (usd === undefined) return undefined
  const color = gradient(COST_STOPS, Math.log10(Math.max(usd, 0.01)))
  const item: Item = {
    id: 'cost',
    accent: color,
    color,
    valueColor: usd < THRESHOLDS.costQuietUsd ? COLORS.value : color,
    mood: 'calm',
    glow: afterglow(state.effects.costFlashUntil, TIMING.costFlashMs, now),
    value: Format.money(usd),
  }
  const turn = shownTurnCost(state, now)
  if (turn !== undefined && turn >= 0.005) item.extras = [{ text: `(+${Format.money(turn)})`, color: COLORS.label }]
  return item
}

const BUILDERS: Record<SegmentId, (state: HudState, now: number) => Item | undefined> = {
  turn,
  context,
  cache,
  fiveHour: (s, now) => limit(s, 'fiveHour', now),
  countdown,
  weekly: (s, now) => limit(s, 'weekly', now),
  cost,
}

export function itemsOf(state: HudState, now: number, order: readonly SegmentId[]): Item[] {
  return order.map((id) => BUILDERS[id](state, now)).filter((i): i is Item => !!i)
}

/** True when a level is critical or the countdown is in its last minute: the terminal needs frames. */
export function isCriticalNow(state: HudState, now: number): boolean {
  const resetsAt = state.limits.fiveHour?.resetsAt
  const finalMinute = resetsAt !== undefined && resetsAt > now && resetsAt - now <= THRESHOLDS.countdownFinalMs
  return (
    isContextCritical(state) ||
    isLimitCritical(state, 'fiveHour', now) ||
    isLimitCritical(state, 'weekly', now) ||
    finalMinute ||
    isCacheFinal(state, now)
  )
}
