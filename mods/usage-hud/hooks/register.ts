// usage-hud: a band above the prompt with the turn, the context window, the
// prompt cache's TTL, the 5-hour and weekly limits, the countdown to the 5-hour reset and the
// session's cost, each with its own colors and animations.
//
// Wiring only: every $ call lives here (`claude plugin validate` reads them
// from source); state.ts folds the figures, view.ts turns them into items,
// terminal.ts and desktop.ts draw those for their surface.

import type { EngineInterface as Api, On } from 'claude-code'

import { drawDesktop } from './desktop'
import { KEY_PREFIX, keyOf, MAX_SESSIONS, parseSaved, restore, resumedCache, snapshotOf, staleKeys } from './persist'
import {
  applyUsage,
  CACHE_TTLS,
  cacheLeft,
  type CacheTtlSetting,
  celebrate,
  dueResets,
  emptyState,
  type HudState,
  isAnimating,
  type LimitKind,
  alertCache,
  dueCacheAlert,
  endTurnCost,
  settleCacheAlerts,
  startTurnCost,
  stateFor,
  touchCache,
} from './state'
import { drawTerminal, type TerminalStyle } from './terminal'
import { type IconSet, LABELS, ORDER, TIMING } from './theme'
import { isCriticalNow, itemsOf } from './view'

type Options = { terminal_icons?: string; terminal_style?: string; cache_ttl?: string }

// Module state: rebuilt from the engine's figures on every load.
let state: HudState = emptyState()
let ticker: { cancel: () => void } | undefined
let lastSecond = -1
/** When a terminal last drew the band: frame animations only run while one does. */
let terminalDrewAt = Number.NEGATIVE_INFINITY

export function register(on: On, options: Options = {}) {
  const icons: IconSet = options.terminal_icons === 'unicode' || options.terminal_icons === 'nerd' ? options.terminal_icons : 'emoji'
  const style: TerminalStyle = options.terminal_style === 'card' || options.terminal_style === 'line' ? options.terminal_style : 'minimal'
  const cacheTtl: CacheTtlSetting = options.cache_ttl === '1h' || options.cache_ttl === '5m' ? options.cache_ttl : 'auto'

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A `claude --resume` raises classic.SessionStart first: keep what it set
    // up for this session. Any other session starts afresh.
    const id = await sessionIdOf($)
    if (state.sessionId !== id) state = stateFor(state, id, cacheTtl)
    await refresh($, true)
    // A hot reload or a restart picks up the cache countdown the store kept.
    await restoreSaved($)
    await pruneStore($)
    ticker?.cancel()
    ticker = $.clock.every(TIMING.frameMs, () => void tick($))
    return result
  })

  // /clear, /resume and /branch switch to another session without
  // session.start (a `claude --resume` raises this first, then session.start).
  // The engine restores a resumed session's cost and context itself, exactly,
  // but only once the switch lands, a moment after this hook: until then
  // $.session.id() and usage() still answer for the session left. So this
  // starts the new session's state from the hook's own session_id and reads
  // the engine's figures once it answers for that session.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    state = stateFor(state, e.session_id, cacheTtl)
    if (e.source !== 'clear') {
      const hint = { secondsSinceLastResponse: e.seconds_since_last_response, contextTokens: e.context_tokens, isCacheLikelyExpired: e.prompt_cache_likely_expired }
      state = settleCacheAlerts(resumedCache(state, now, hint), now)
    }
    $.ui.invalidate('ui.render')
    void refreshOnceSwitched($, e.session_id)
    return result
  }).catch(passThrough)

  // The session is ending (an exit, or a /clear, /resume or /branch leaving
  // it): save its cache countdown, then nothing more under its id.
  on('session.end', async ($, e, next) => {
    await save($)
    state = { ...state, sessionId: undefined }
    return next(e)
  })

  // Pushed after each turn and whenever a rate-limit window moves a point.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    state = applyUsage(state, e, now)
    celebrateDue($, now)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Every main-loop response that reads or writes the prompt cache restarts its TTL.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId || !result.usage) return result
    state = touchCache(state, result.usage, await $.clock.now())
    $.ui.invalidate('ui.render')
    await save($)
    return result
  })

  // A switch reports the session's real TTL, and leaves the new model's cache cold.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id) return result
    const now = await $.clock.now()
    const reportedCacheTtlMs = CACHE_TTLS[e.cache_ttl] ?? state.reportedCacheTtlMs
    state = { ...state, reportedCacheTtlMs, cache: state.cache && { ...state.cache, touchedAt: now - state.cache.ttlMs } }
    $.ui.invalidate('ui.render')
    return result
  }).catch(passThrough)

  on('turn.start', async ($, e, next) => {
    // Only the main loop raises turn.start; subagents don't.
    state = startTurnCost({ ...state, isWorking: true, turns: await turnsOf($, state.turns + 1) })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const now = await $.clock.now()
    state = { ...state, isWorking: false, effects: { ...state.effects, turnFlashUntil: now + TIMING.turnFlashMs } }
    await refresh($, false)
    // The turn's cost shows from when its figures are read.
    state = endTurnCost(state, await $.clock.now(), TIMING.turnCostMs)
    $.ui.invalidate('ui.render')
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = (e.props ?? {}) as { hasSurvey?: boolean; isCollapsed?: boolean; isWorking?: boolean; bodyColumns?: number; maxRows?: number }
    if (props.hasSurvey) return next(e)
    const now = await $.clock.now()
    const view: HudState = props.isWorking === undefined ? state : { ...state, isWorking: props.isWorking }
    const items = itemsOf(view, now, ORDER)
    const el = $.ui.resolve(e) as unknown as Record<string, (props: Record<string, unknown>) => unknown>
    let tree: unknown
    if (e.surface === 'terminal') {
      // A collapsed band still draws, but nobody sees its frames: don't keep animating it.
      if (!props.isCollapsed) terminalDrewAt = now
      const columns = props.bodyColumns ?? e.viewport?.columns ?? 80
      tree = drawTerminal(el.Box!, el.Text!, items, now, { icons, style, columns, maxRows: props.maxRows ?? 10 })
    } else if (el.Svg) {
      tree = drawDesktop(el.Box!, el.Text!, el.Svg, items)
    }
    return tree === undefined ? next(e) : (tree as never)
  })
}

/** Reads usage and the turn count from the engine and redraws. */
async function refresh($: Api, isFirst: boolean) {
  try {
    const now = await $.clock.now()
    const usage = await $.session.usage()
    state = applyUsage(state, usage, now, isFirst)
    state = { ...state, turns: await turnsOf($, state.turns) }
    celebrateDue($, now)
  } catch {
    // Keep the last figures; the next measure brings fresh ones.
  }
  $.ui.invalidate('ui.render')
}

/** Waits (up to ~3 s) until the engine answers for `sessionId`, then reads its figures. */
async function refreshOnceSwitched($: Api, sessionId: string) {
  for (let i = 0; i < 15; i++) {
    if (state.sessionId !== sessionId) return
    if ((await sessionIdOf($)) === sessionId) break
    await $.clock.sleep(200)
  }
  if (state.sessionId === sessionId) await refresh($, true)
}

/**
 * These two run at gating sites: if one throws, the HUD only loses a figure,
 * so the session goes on as if it weren't there.
 */
function passThrough(_$: unknown, e: any, next: { called: boolean } & ((e: any) => any)) {
  return next.called ? undefined : next(e)
}

async function sessionIdOf($: Api): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

/** Saves this session's cache countdown under its own key; nothing while no session is current. */
async function save($: Api) {
  const id = state.sessionId
  if (!id) return
  try {
    await $.store.set(keyOf(id), snapshotOf(state, await $.clock.now()))
  } catch {
    // Not saved this time; the next response tries again.
  }
}

/** Folds what the store kept for this session into the state, if anything. */
async function restoreSaved($: Api) {
  const id = state.sessionId
  if (!id) return
  try {
    const now = await $.clock.now()
    state = settleCacheAlerts(restore(state, parseSaved(await $.store.get(keyOf(id))), now), now)
  } catch {
    // Nothing to pick up.
  }
  $.ui.invalidate('ui.render')
}

/** Keeps only the most recently saved sessions in the store. */
async function pruneStore($: Api) {
  try {
    const keys = (await $.store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
    if (keys.length <= MAX_SESSIONS) return
    const entries = []
    for (const key of keys) entries.push({ key, savedAt: parseSaved(await $.store.get(key))?.savedAt ?? 0 })
    for (const key of staleKeys(entries)) await $.store.delete(key)
  } catch {
    // Pruned next session.
  }
}

async function turnsOf($: Api, fallback: number): Promise<number> {
  try {
    return await $.session.turns()
  } catch {
    return fallback
  }
}

const TOASTS: Record<LimitKind, string> = { fiveHour: LABELS.toastFiveHour, weekly: LABELS.toastWeekly }

function celebrateDue($: Api, now: number) {
  const due = dueResets(state, now)
  if (due.length === 0) return
  state = celebrate(state, due, now)
  for (const kind of due) $.ui.toast(TOASTS[kind])
}

/**
 * Every frame: start due celebrations, and redraw when the countdown's
 * second ticks, or every frame while something animates in a terminal
 * (Desktop animates inside its SVGs and needs no frames).
 */
async function tick($: Api) {
  const now = await $.clock.now()
  celebrateDue($, now)
  const alert = dueCacheAlert(state, now)
  if (alert !== undefined) {
    state = alertCache(state, alert, now)
    $.ui.toast(LABELS.cacheToast(alert))
  }
  const second = Math.floor(now / 1000)
  // The cache's countdown ticks until a moment past its expiry, to draw `fría`.
  const cacheTicking = (cacheLeft(state, now) ?? Number.NEGATIVE_INFINITY) > -2_000
  const ticks = (state.limits.fiveHour?.resetsAt !== undefined || cacheTicking) && second !== lastSecond
  lastSecond = second
  const glowing =
    state.effects.turnFlashUntil > now ||
    state.effects.costFlashUntil > now ||
    state.effects.cacheShakeUntil > now ||
    (state.turnCost?.showUntil ?? 0) > now - TIMING.frameMs
  const framed = now - terminalDrewAt < 5_000 && isAnimating(state, now, isCriticalNow(state, now))
  if (ticks || glowing || framed) $.ui.invalidate('ui.render')
}
