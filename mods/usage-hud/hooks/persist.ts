// What the HUD keeps per session in $.store: only the prompt cache's
// countdown, which the engine doesn't report, so a hot reload or a restart
// picks it up. Cost and context are never kept here: the engine restores
// those itself on a resume, exactly, and is the one source of truth.
// Pure: register.ts reads and writes the store and hands the values here.

import { CACHE_TTLS, type CacheState, cacheTtlMs, type HudState, isTtlUnknown } from './state'

/** One key per session, so two sessions writing at once never clobber each other. */
export const KEY_PREFIX = 'session:'

/** How many sessions the store keeps; the oldest saved go first. */
export const MAX_SESSIONS = 30

export type Saved = {
  savedAt: number
  cache?: CacheState
}

export function keyOf(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`
}

/** What to save of the state now. */
export function snapshotOf(state: HudState, now: number): Saved {
  const saved: Saved = { savedAt: now }
  if (state.cache) {
    const { touchedAt, tokens, ttlMs, isTtlPending, promptTokens, model } = state.cache
    saved.cache = { touchedAt, tokens, ttlMs }
    if (isTtlPending) saved.cache.isTtlPending = true
    if (promptTokens !== undefined) saved.cache.promptTokens = promptTokens
    if (model !== undefined) saved.cache.model = model
  }
  return saved
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A stored value read back, or undefined when it isn't one of ours (older versions' extra fields are ignored). */
export function parseSaved(raw: unknown): Saved | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, any>
  if (!isNumber(r.savedAt)) return undefined
  const saved: Saved = { savedAt: r.savedAt }
  const k = r.cache
  if (k && isNumber(k.touchedAt) && isNumber(k.tokens) && isNumber(k.ttlMs)) {
    saved.cache = { touchedAt: k.touchedAt, tokens: k.tokens, ttlMs: k.ttlMs }
    if (k.isTtlPending === true) saved.cache.isTtlPending = true
    if (isNumber(k.promptTokens)) saved.cache.promptTokens = k.promptTokens
    if (typeof k.model === 'string') saved.cache.model = k.model
  }
  return saved
}

/**
 * Folds what the store had for this session into the state: the cache
 * countdown, if the state has none. One saved while its TTL was pending takes
 * it now if the limits are already read.
 */
export function restore(state: HudState, saved: Saved | undefined, now = 0): HudState {
  if (!saved?.cache || state.cache) return state
  const { isTtlPending, ...cache } = saved.cache
  if (!isTtlPending) return { ...state, cache }
  return isTtlUnknown(state) ? { ...state, cache: saved.cache } : { ...state, cache: { ...cache, ttlMs: cacheTtlMs(state, now) } }
}

/** What a resume says of the transcript's last response (`classic.SessionStart`). */
export type ResumeHint = {
  secondsSinceLastResponse?: number
  contextTokens?: number
  /** The engine's own call: the time since exceeds the prompt cache's TTL. */
  isCacheLikelyExpired?: boolean
}

/**
 * A resume or branch as the engine reports it: the time since the
 * transcript's last response restarts the cache countdown from then. (Its
 * `context_tokens` is no measure of the window: it adds the response's
 * output. The engine's own figures come once the switch lands.)
 *
 * The engine's `prompt_cache_likely_expired` pins the TTL where it can only
 * be one: expired within the hour means 5m; still warm past 5 minutes means 1h.
 */
export function resumedCache(state: HudState, now: number, hint: ResumeHint): HudState {
  const seconds = hint.secondsSinceLastResponse
  if (seconds === undefined) return state
  const cache = { touchedAt: now - seconds * 1000, tokens: hint.contextTokens ?? 0, ttlMs: cacheTtlMs(state, now) }
  const pinned = ttlFromHint(seconds, hint.isCacheLikelyExpired)
  if (pinned !== undefined && state.cacheTtlSetting === 'auto' && state.reportedCacheTtlMs === undefined) {
    return { ...state, cache: { ...cache, ttlMs: pinned } }
  }
  // The limits that decide an `auto` TTL may not be read yet: the next reading settles it.
  return { ...state, cache: isTtlUnknown(state) ? { ...cache, isTtlPending: true } : cache }
}

function ttlFromHint(seconds: number, isExpired: boolean | undefined): number | undefined {
  if (isExpired === undefined) return undefined
  const ms = seconds * 1000
  if (isExpired && ms < CACHE_TTLS['1h']) return CACHE_TTLS['5m']
  if (!isExpired && ms > CACHE_TTLS['5m']) return CACHE_TTLS['1h']
  return undefined
}

/** The keys to delete so only the MAX_SESSIONS most recently saved stay. */
export function staleKeys(entries: readonly { key: string; savedAt: number }[]): string[] {
  return [...entries]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(MAX_SESSIONS)
    .map((e) => e.key)
}
