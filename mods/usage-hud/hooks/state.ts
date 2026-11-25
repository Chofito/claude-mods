// What the HUD knows, and the pure transitions that change it. register.ts
// owns one HudState and feeds it the engine's figures; view.ts reads it.

import type { ModelUsage, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'

import { CACHE_ALERTS, TIMING } from './theme'

export type LimitKind = 'fiveHour' | 'weekly'

export type Limit = {
  percentUsed: number
  /** Epoch ms; absent when the engine reported none. */
  resetsAt?: number
}

export type HudState = {
  /** Prompts the user has sent this session: the current turn. */
  turns: number
  isWorking: boolean
  /**
   * The session these figures belong to: set at `session.start`, and from the
   * hook's own `session_id` on a resume, clear or branch (while the switch
   * lands, `$.session.id()` still names the session left). Unset while ending,
   * so nothing is saved under the wrong session.
   */
  sessionId?: string
  context?: { tokens: number; window: number; percent: number }
  limits: Partial<Record<LimitKind, Limit>>
  /** The session's cost as the engine counts it: across processes, a resume restores it. */
  costUsd?: number
  /**
   * The prompt cache as the last main-loop response left it: each response
   * that read or wrote the cache restarts its TTL. Absent until one does.
   */
  cache?: CacheState
  /**
   * The session's cost when the current turn started, and until when the
   * turn's own cost shows beside the total once it ended (unset while it runs).
   */
  turnCost?: { startUsd: number; showUntil?: number }
  /** The `cache_ttl` option: `auto` follows the account. */
  cacheTtlSetting: CacheTtlSetting
  /** The main conversation's TTL as a model switch reported it, the engine's own. */
  reportedCacheTtlMs?: number
  /** Epoch ms until which each effect plays. */
  effects: {
    turnFlashUntil: number
    costFlashUntil: number
    celebrateUntil: Partial<Record<LimitKind, number>>
    cacheShakeUntil: number
  }
  /** Minutes of CACHE_ALERTS already announced for the cache as last touched. */
  cacheAlerted: number[]
  /** `kind@resetsAt` of every reset already celebrated, so each plays once. */
  celebrated: Set<string>
}

export type CacheState = {
  touchedAt: number
  /** Tokens the response read from or wrote to the cache. */
  tokens: number
  ttlMs: number
  isTtlPending?: boolean
  /** What the next request re-sends: the response's input, cache and output tokens. */
  promptTokens?: number
  /** The model that answered, as the API reports it: the cache is that model's. */
  model?: string
}

export const CACHE_TTLS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

export type CacheTtlSetting = keyof typeof CACHE_TTLS | 'auto'

export function emptyState(cacheTtlSetting: CacheTtlSetting = 'auto'): HudState {
  return {
    turns: 0,
    cacheTtlSetting,
    isWorking: false,
    limits: {},
    effects: { turnFlashUntil: 0, costFlashUntil: 0, celebrateUntil: {}, cacheShakeUntil: 0 },
    cacheAlerted: [],
    celebrated: new Set(),
  }
}

const KIND_OF: Record<string, LimitKind> = { five_hour: 'fiveHour', seven_day: 'weekly' }

function limitOf(raw: SessionRateLimit): Limit {
  const resetsAt = raw.resetsAt ? Date.parse(raw.resetsAt) : Number.NaN
  return Number.isFinite(resetsAt) ? { percentUsed: raw.percentUsed, resetsAt } : { percentUsed: raw.percentUsed }
}

function keyOf(kind: LimitKind, limit: Limit): string {
  return `${kind}@${limit.resetsAt ?? 'none'}`
}

/**
 * Folds a `$.session.usage()` answer (or a `session.measure` input) into the
 * state. `isFirst` marks resets that already passed before the HUD loaded as
 * celebrated, so a fresh session doesn't throw a party for an old reset.
 */
export function applyUsage(state: HudState, usage: Partial<SessionUsage>, now: number, isFirst = false): HudState {
  const next: HudState = { ...state, limits: { ...state.limits }, effects: { ...state.effects } }

  const ctx = usage.context
  if (ctx && ctx.window) {
    const tokens = ctx.tokens ?? 0
    next.context = { tokens, window: ctx.window, percent: ctx.percent ?? (tokens / ctx.window) * 100 }
  }

  for (const raw of usage.rateLimits ?? []) {
    const kind = KIND_OF[raw.kind]
    if (!kind) continue
    const limit = limitOf(raw)
    next.limits[kind] = limit
    if (isFirst && limit.resetsAt !== undefined && limit.resetsAt <= now) next.celebrated.add(keyOf(kind, limit))
  }

  if (usage.cost) {
    const grew = state.costUsd !== undefined && usage.cost.usd > state.costUsd + 0.005
    next.costUsd = usage.cost.usd
    if (grew) next.effects.costFlashUntil = now + TIMING.costFlashMs
  }

  // A countdown started before the limits were known (a fresh process's first
  // response, a resume's first event) takes its TTL once a reading names a
  // window. An empty list says nothing: it is also what comes before the first
  // reading, and off a subscription the 5-minute guess already stands.
  if (next.cache?.isTtlPending && (usage.rateLimits?.length ?? 0) > 0) {
    const { isTtlPending: _, ...cache } = next.cache
    return settleCacheAlerts({ ...next, cache: { ...cache, ttlMs: cacheTtlMs(next, now) }, cacheAlerted: [] }, now)
  }

  return next
}

/**
 * The main conversation's TTL now. What a model switch reported wins; then
 * an explicit option; `auto` follows Claude Code's defaults: one hour on a
 * subscription within its plan (a rate-limit window, none used up), five
 * minutes on usage credits, an API key or a cloud provider. A
 * `promptCacheTtl` setting or TTL env var is invisible here: set the option.
 */
export function cacheTtlMs(state: HudState, now: number): number {
  if (state.reportedCacheTtlMs !== undefined) return state.reportedCacheTtlMs
  if (state.cacheTtlSetting !== 'auto') return CACHE_TTLS[state.cacheTtlSetting]
  const limits = Object.values(state.limits).map((l) => effectiveLimit(l, now)!)
  const withinPlan = limits.length > 0 && limits.every((l) => l.percentUsed < 100)
  return withinPlan ? CACHE_TTLS['1h'] : CACHE_TTLS['5m']
}

/**
 * True while an `auto` TTL can't be told yet: no rate-limit reading and no
 * model switch, as in a fresh process before its first `session.measure`.
 */
export function isTtlUnknown(state: HudState): boolean {
  return state.cacheTtlSetting === 'auto' && state.reportedCacheTtlMs === undefined && Object.keys(state.limits).length === 0
}

/**
 * Restarts the cache's TTL when a response read or wrote it; the TTL is the
 * one it was written with. Before any limit reading it is pending: the first
 * reading decides between 1h and 5m (a fresh session's first response used to
 * stick at 5m on a subscription).
 */
export function touchCache(state: HudState, usage: (ModelUsage & Partial<TurnUsage>) | null | undefined, now: number): HudState {
  if (!usage) return state
  const tokens = usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (tokens === 0) return state
  const promptTokens = usage.input_tokens + tokens + usage.output_tokens
  const base: CacheState = { touchedAt: now, tokens, ttlMs: cacheTtlMs(state, now), promptTokens }
  if (usage.model) base.model = usage.model
  const written = writtenTtlMs(usage)
  // A read alone renews the entry at the TTL it was written with.
  const kept = written === undefined && usage.cache_creation_input_tokens === 0 && state.cache && !state.cache.isTtlPending ? state.cache.ttlMs : undefined
  const known = written ?? kept
  const cache = known !== undefined ? { ...base, ttlMs: known } : isTtlUnknown(state) ? { ...base, isTtlPending: true } : base
  return { ...state, cache, cacheAlerted: [] }
}

/**
 * The TTL the response wrote the cache with, as the API split the write
 * (`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`): the engine's own
 * figure, so no guess is needed. A write of both lives as long as the shorter.
 */
export function writtenTtlMs(usage: Partial<TurnUsage>): number | undefined {
  const h = usage.ephemeral_1h_input_tokens ?? 0
  const m = usage.ephemeral_5m_input_tokens ?? 0
  if (m > 0) return CACHE_TTLS['5m']
  if (h > 0) return CACHE_TTLS['1h']
  return undefined
}

/** A main-loop turn started: its cost counts from the session's total now. */
export function startTurnCost(state: HudState): HudState {
  return { ...state, turnCost: { startUsd: state.costUsd ?? 0 } }
}

/** The turn ended: its cost shows beside the total for `ms`. */
export function endTurnCost(state: HudState, now: number, ms: number): HudState {
  return state.turnCost ? { ...state, turnCost: { ...state.turnCost, showUntil: now + ms } } : state
}

/** The ended turn's cost while it shows, else undefined. */
export function shownTurnCost(state: HudState, now: number): number | undefined {
  const t = state.turnCost
  if (t?.showUntil === undefined || t.showUntil <= now || state.costUsd === undefined) return undefined
  return Math.max(0, state.costUsd - t.startUsd)
}

/**
 * The 5-hour window's pace: percent used per hour since it opened (its reset
 * minus five hours), and when it runs out at that pace if that comes before
 * the reset. Undefined until 10 minutes and 1% into the window.
 */
export function fiveHourPace(state: HudState, now: number): { percentPerHour: number; runsOutAt?: number } | undefined {
  const limit = state.limits.fiveHour
  if (limit?.resetsAt === undefined || limit.resetsAt <= now) return undefined
  const elapsed = now - (limit.resetsAt - FIVE_HOURS)
  if (elapsed < 10 * 60_000 || limit.percentUsed < 1) return undefined
  const percentPerHour = (limit.percentUsed / elapsed) * 3_600_000
  if (limit.percentUsed >= 100) return { percentPerHour, runsOutAt: now }
  const runsOutAt = now + ((100 - limit.percentUsed) / percentPerHour) * 3_600_000
  return runsOutAt < limit.resetsAt ? { percentPerHour, runsOutAt } : { percentPerHour }
}

const FIVE_HOURS = 5 * 3_600_000

/**
 * The alert the cache just crossed into, by its minutes: the lowest one it
 * is now under that hasn't been announced, and that it started above (a
 * 5-minute TTL never announces 5 or 15). Undefined when none is due.
 */
export function dueCacheAlert(state: HudState, now: number): number | undefined {
  const left = cacheLeft(state, now)
  if (left === undefined || left <= 0) return undefined
  const due = CACHE_ALERTS.filter(
    (a) => left <= a.minutes * 60_000 && state.cache!.ttlMs > a.minutes * 60_000 && !state.cacheAlerted.includes(a.minutes),
  )
  return due.length > 0 ? Math.min(...due.map((a) => a.minutes)) : undefined
}

/** Announces the alert of `minutes`: it and every one above it count as done; the value shakes. */
export function alertCache(state: HudState, minutes: number, now: number): HudState {
  const done = CACHE_ALERTS.filter((a) => a.minutes >= minutes).map((a) => a.minutes)
  return {
    ...state,
    cacheAlerted: [...new Set([...state.cacheAlerted, ...done])],
    effects: { ...state.effects, cacheShakeUntil: now + TIMING.cacheShakeMs },
  }
}

/** Marks every alert the cache is already under as done, unannounced: a restored cache doesn't toast its past. */
export function settleCacheAlerts(state: HudState, now: number): HudState {
  const left = cacheLeft(state, now)
  if (left === undefined) return state
  const done = CACHE_ALERTS.filter((a) => left <= a.minutes * 60_000).map((a) => a.minutes)
  return { ...state, cacheAlerted: [...new Set([...state.cacheAlerted, ...done])] }
}

/** Ms until the cache expires: negative once it has, undefined before any response. */
export function cacheLeft(state: HudState, now: number): number | undefined {
  return state.cache ? state.cache.touchedAt + state.cache.ttlMs - now : undefined
}

/** The session's cost, or undefined before any figure. */
export function totalCost(state: HudState): number | undefined {
  return state.costUsd
}

/**
 * A fresh state for `sessionId`, keeping what belongs to the account and not
 * the session: the rate limits and which resets already celebrated.
 */
export function stateFor(state: HudState, sessionId: string | undefined, cacheTtlSetting: CacheTtlSetting): HudState {
  return { ...emptyState(cacheTtlSetting), sessionId, limits: state.limits, celebrated: state.celebrated }
}

/** The limit as it stands at `now`: once its reset time has passed, it's fresh. */
export function effectiveLimit(limit: Limit | undefined, now: number): Limit | undefined {
  if (!limit) return undefined
  if (limit.resetsAt !== undefined && limit.resetsAt <= now) return { percentUsed: 0 }
  return limit
}

/** Windows whose reset time has passed and that haven't celebrated yet. */
export function dueResets(state: HudState, now: number): LimitKind[] {
  const due: LimitKind[] = []
  for (const kind of ['fiveHour', 'weekly'] as const) {
    const limit = state.limits[kind]
    if (limit?.resetsAt === undefined || limit.resetsAt > now) continue
    if (!state.celebrated.has(keyOf(kind, limit))) due.push(kind)
  }
  return due
}

/** Starts the celebration of each window in `kinds` and marks it done. */
export function celebrate(state: HudState, kinds: readonly LimitKind[], now: number): HudState {
  const celebrateUntil = { ...state.effects.celebrateUntil }
  for (const kind of kinds) {
    celebrateUntil[kind] = now + TIMING.celebrateMs
    const limit = state.limits[kind]
    if (limit) state.celebrated.add(keyOf(kind, limit))
  }
  return { ...state, effects: { ...state.effects, celebrateUntil } }
}

export function isCelebrating(state: HudState, kind: LimitKind, now: number): boolean {
  return (state.effects.celebrateUntil[kind] ?? 0) > now
}

/** True while anything on the band moves, so the frame timer should redraw. */
export function isAnimating(state: HudState, now: number, criticalNow: boolean): boolean {
  const { effects } = state
  return (
    state.isWorking ||
    criticalNow ||
    effects.turnFlashUntil > now ||
    effects.costFlashUntil > now ||
    effects.cacheShakeUntil > now ||
    Object.values(effects.celebrateUntil).some((until) => (until ?? 0) > now)
  )
}
