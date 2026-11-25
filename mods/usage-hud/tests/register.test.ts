import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import * as Format from '../hooks/format'

const HOUR = 3_600_000
// 2026-10-06 12:00 UTC: the mock clock starts here.
const NOW = Date.UTC(2026, 9, 6, 12)

const BAND = {
  plugin: 'usage-hud',
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type Usage = {
  startedAt: number
  context: { tokens: number; window: number; percent: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function usageOf(over: Partial<Usage> = {}): Usage {
  return {
    startedAt: NOW,
    context: { tokens: 221_000, window: 1_000_000, percent: 22.1 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(NOW + 2 * HOUR + 14 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 59, resetsAt: new Date(NOW + 6 * 24 * HOUR).toISOString() },
    ],
    cost: { usd: 1.23 },
    ...over,
  }
}

/** Stubs the engine under the mod; returns the toasts it showed and its store. */
function world(on: On, usage: () => Usage, turns = () => 3, sessionId = () => 'sess-1', store = new Map<string, unknown>()) {
  const clock = mock.clock(on, { now: NOW })
  const toasts: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: sessionId() }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: usage() }))
  on('session.turns', () => ({ value: turns() }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  return { clock, toasts, store }
}

const CACHED = { input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 1_000, model: 'claude-opus-5-5' }

/** Answers every model request beneath the mod with `usage`. */
function responds(on: On, usage: typeof CACHED | null = CACHED) {
  on('turn.step', async function* ($, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
  })
}

/** Runs one model request through the mod, reading its stream to the end. */
async function step($: any, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream);
  return stream.result
}

/** Every string in a drawn tree, joined. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object') {
    const { props, children } = node as { props?: { children?: unknown }; children?: unknown }
    return textOf(children ?? props?.children ?? '')
  }
  return ''
}

async function drawn($: any, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const box = await ui.find({ type: 'Box' })
  await ui.unmount()
  return textOf(box)
}

/** Every node's props in a drawn tree (the kit may wrap the band in a Box of its own). */
function propsOf(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(propsOf)
  if (!node || typeof node !== 'object') return []
  const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
  return [...(props ? [props] : []), ...propsOf(children ?? props?.children)]
}

/** Every Svg's source in a drawn tree. */
function svgsOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(svgsOf)
  if (!node || typeof node !== 'object') return []
  const { type, props, children } = node as { type?: string; props?: { source?: string; children?: unknown }; children?: unknown }
  const own = type === 'Svg' && props?.source ? [props.source] : []
  return [...own, ...svgsOf(children ?? props?.children)]
}

const API_KEY_USAGE = () => usageOf({ rateLimits: [] })

describe('register', () => {
  test('draws every segment, left to right from the turn', async ($, on) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const text = await drawn($)

    expect(text).toContain('💬 3')
    expect(text).toContain('221k/1M')
    expect(text).toContain('▰▰▰▰▰▰▱▱▱▱ 62%')
    expect(text).toContain('2h14m')
    expect(text).toContain('$1.23')
    expect(text.indexOf('💬 3')).toBeLessThan(text.indexOf('$1.23'))
  })

  test('hides the limit segments off a subscription', async ($, on) => {
    world(on, () => usageOf({ rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const text = await drawn($)

    expect(text).toContain('💬 3')
    expect(text).not.toContain('5h')
    expect(text).not.toContain('2h14m')
  })

  test('celebrates the 5-hour reset once, with a toast', async ($, on) => {
    const resetsAt = new Date(NOW + 5_000).toISOString()
    const { clock, toasts } = world(on, () =>
      usageOf({ rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt }] }),
    )
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(await drawn($)).toContain('5s')

    await clock.advance(6_000)
    expect(toasts).toEqual(['✦ Tu límite de 5 horas se reseteó'])
    expect(await drawn($)).toContain('¡RESET!')

    await clock.advance(10_000)
    expect(toasts.length).toBe(1)
    const after = await drawn($)
    expect(after).toContain('listo')
    expect(after).toContain('100%')
  })

  test('a reset that passed before the session loaded does not celebrate', async ($, on) => {
    const resetsAt = new Date(NOW - 60_000).toISOString()
    const { clock, toasts } = world(on, () =>
      usageOf({ rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt }] }),
    )
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(1_000)
    expect(toasts).toEqual([])
  })

  test('drops segments to fit a narrow band, keeping the turn and context', async ($, on) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 34 } })
    const text = textOf(await ui.find({ type: 'Box' }))

    expect(text).toContain('💬 3')
    expect(text).toContain('221k/1M')
    expect(text).not.toContain('$1.23')
  })

  test('the turn counter follows the session', async ($, on) => {
    let turns = 1
    world(on, () => usageOf(), () => turns)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(await drawn($)).toContain('💬 1')

    turns = 2
    await $.turn.start({ text: 'otra vez', turnId: 't2' })
    await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: null } as any)
    expect(await drawn($)).toContain('💬 2')
  })

  test('the card style draws a rounded card', { options: { terminal_style: 'card' } } as any, async ($: any, on: any) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(propsOf(await ui.find({ type: 'Box' })).some((p) => p.borderStyle === 'round')).toBe(true)
  })

  test('Desktop draws SVG icons and bars, and plain text values', async ($, on) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const root = await ui.find({ type: 'Box' })
    const text = textOf(root)
    expect(text).toContain('Turno')
    expect(text).toContain('221k/1M')
    expect(text).not.toContain('█')
    // Seven ring icons (the cache's waits with `—`) and two bars
    expect(svgsOf(root).length).toBe(9)
    expect(svgsOf(root).filter((src) => src.includes('linearGradient')).length).toBe(2)
  })

  test('Desktop celebrates a reset with an animated SVG', async ($, on) => {
    const resetsAt = new Date(NOW + 5_000).toISOString()
    const { clock } = world(on, () => usageOf({ rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt }] }))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    await clock.advance(6_000)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const reset = svgsOf(await ui.find({ type: 'Box' })).find((src) => src.includes('¡RESET!'))
    expect(reset).toBeDefined()
    expect(reset!).toContain('animateTransform')
  })

  test('unicode icons when the option says so', { options: { terminal_icons: 'unicode' } } as any, async ($: any, on: any) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const text = await drawn($)
    expect(text).toContain('◆ 3')
    expect(text).not.toContain('💬')
  })

  test('Nerd Font icons when the option says so', { options: { terminal_icons: 'nerd' } } as any, async ($: any, on: any) => {
    world(on, () => usageOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const text = await drawn($)
    expect(text).toContain('\uf086 3')
    expect(text).not.toContain('💬')
  })

  // No rate-limit windows: an API key, five minutes by default.
  const API_KEY = () => usageOf({ rateLimits: [] })

  test('the cache counts down from the last response, then goes cold', async ($, on) => {
    const { clock } = world(on, API_KEY)
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(await drawn($)).toContain('🧊 —')

    await step($)
    expect(await drawn($)).toContain('🧊 5:00')

    await clock.advance(3 * 60_000)
    expect(await drawn($)).toContain('🧊 2:00')

    await step($)
    expect(await drawn($)).toContain('🧊 5:00')

    await clock.advance(5 * 60_000 + 1_000)
    expect(await drawn($)).toContain('🧊 fría')
  })

  test("a subagent's response doesn't touch the countdown", async ($, on) => {
    const { clock } = world(on, API_KEY)
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await step($)
    await clock.advance(60_000)
    await step($, 'agent-1')
    expect(await drawn($)).toContain('🧊 4:00')
  })

  test('auto: a subscription within its plan gets an hour', async ($, on) => {
    world(on, () => usageOf())
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await step($)
    expect(await drawn($)).toContain('🧊 60:00')
  })

  test('the cache counts as a minutes:seconds clock', async ($, on) => {
    const { clock } = world(on, () => usageOf())
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await step($)
    // A minute at a time: the 100 ms frame timer fires on every step.
    for (let i = 0; i < 10; i++) await clock.advance(60_000)
    expect(await drawn($)).toContain('🧊 50:00')
    for (let i = 0; i < 46; i++) await clock.advance(60_000)
    expect(await drawn($)).toContain('🧊 4:00')
  })

  test('auto: past the plan (usage credits) drops to five minutes', async ($, on) => {
    const resetsAt = new Date(NOW + HOUR).toISOString()
    world(on, () => usageOf({ rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt }] }))
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await step($)
    expect(await drawn($)).toContain('🧊 5:00')
  })

  test('the 1h option overrides auto', { options: { cache_ttl: '1h' } } as any, async ($: any, on: any) => {
    world(on, API_KEY)
    responds(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await step($)
    expect(await drawn($)).toContain('🧊 60:00')
  })

  test('Desktop draws the cache with its own icon', async ($, on) => {
    world(on, API_KEY)
    responds(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    await step($)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const root = await ui.find({ type: 'Box' })
    expect(textOf(root)).toContain('5:00')
    expect(svgsOf(root).some((src) => src.includes('<ellipse'))).toBe(true)
  })

  describe('cache alerts', () => {
    const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
    const minutes = async (clock: { advance: (ms: number) => Promise<unknown> }, n: number) => {
      for (let i = 0; i < n; i++) await clock.advance(60_000)
    }

    test('an hour-long cache announces 15, 10, 5 and 1 minutes left, once each', async ($, on) => {
      const { clock, toasts } = world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)

      await minutes(clock, 45)
      expect(toasts).toEqual(['✦ Tu caché expira en 15 minutos'])
      await minutes(clock, 5)
      await minutes(clock, 5)
      await minutes(clock, 4)
      expect(toasts).toEqual([
        '✦ Tu caché expira en 15 minutos',
        '✦ Tu caché expira en 10 minutos',
        '✦ Tu caché expira en 5 minutos',
        '✦ Tu caché expira en 1 minuto',
      ])
      await minutes(clock, 2)
      expect(toasts.length).toBe(4)
    })

    test('the value takes the alert color and shakes when it crosses one', async ($, on) => {
      const { clock } = world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)
      await minutes(clock, 50)
      const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
      const box = await ui.find({ type: 'Box' })
      expect(JSON.stringify(box)).toContain('#c8a35f')
    })

    test('a 5-minute cache only announces its last minute', async ($, on) => {
      const { clock, toasts } = world(on, () => usageOf({ rateLimits: [] }))
      responds(on)
      await $.session.start(START)
      await step($)
      await minutes(clock, 5)
      expect(toasts).toEqual(['✦ Tu caché expira en 1 minuto'])
    })

    test('a response before an alert starts the alerts over', { timeoutMs: 15_000 }, async ($, on) => {
      const { clock, toasts } = world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)
      await minutes(clock, 46)
      await step($)
      await minutes(clock, 46)
      expect(toasts).toEqual(['✦ Tu caché expira en 15 minutos', '✦ Tu caché expira en 15 minutos'])
    })

    test('a restored cache does not announce what already passed', async ($, on) => {
      const { clock, toasts } = world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)
      await minutes(clock, 52)
      expect(toasts.length).toBe(2)
      // A reload with 8 minutes left: the 10 and 15 passed, the 5 is still ahead.
      toasts.length = 0
      await $.session.start(START)
      await minutes(clock, 1)
      expect(toasts).toEqual([])
      await minutes(clock, 2)
      expect(toasts).toEqual(['✦ Tu caché expira en 5 minutos'])
    })
  })

  describe('persistence', () => {
    const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

    /**
     * The engine as a probe of Claude Code 2.1.299 saw it on a resume: until the
     * switch lands, a moment after classic.SessionStart, $.session.id() and
     * usage() still answer for the session left; then they answer for the
     * resumed one, its cost and context restored exactly.
     */
    function resumable(on: On, before: Usage, after: Usage) {
      let switched = false
      const w = world(on, () => (switched ? after : before), () => 3, () => (switched ? 'resumed' : 'fresh'))
      on('classic.SessionStart', () => ({}))
      return { ...w, land: () => (switched = true) }
    }

    test('/resume shows the cost and context the engine restores, not zero and not an estimate', async ($, on) => {
      const fresh = usageOf({ context: { window: 1_000_000 } as any, cost: { usd: 0 } })
      const resumed = usageOf({ context: { tokens: 330_164, window: 1_000_000, percent: 33 }, cost: { usd: 8.84 } })
      const { clock, land } = resumable(on, fresh, resumed)
      await $.session.start(START)
      await $.classic.SessionStart({ source: 'resume', session_id: 'resumed', seconds_since_last_response: 120, context_tokens: 341_000 } as any)
      await clock.advance(200)
      land()
      await clock.advance(400)
      const text = await drawn($)
      expect(text).toContain('$8.84')
      expect(text).toContain('330k/1M')
      expect(text).not.toContain('341k')
      expect(text).toContain('58:00')
    })

    test('a cost saved by an older version is never added on top of the restored one', async ($, on) => {
      const store = new Map<string, unknown>([['session:sess-1', { savedAt: NOW - 60_000, totalUsd: 8.84, context: { tokens: 1, window: 1, percent: 1 } }]])
      world(on, () => usageOf({ cost: { usd: 8.84 } }), () => 3, () => 'sess-1', store)
      await $.session.start(START)
      const text = await drawn($)
      expect(text).toContain('$8.84')
      expect(text).not.toContain('$17.68')
    })

    test('claude --resume: the countdown set by SessionStart survives the session.start after it', async ($, on) => {
      world(on, () => usageOf({ cost: { usd: 2.5 } }), () => 3, () => 'resumed')
      on('classic.SessionStart', () => ({}))
      await $.classic.SessionStart({ source: 'resume', session_id: 'resumed', seconds_since_last_response: 300 } as any)
      await $.session.start(START)
      const text = await drawn($)
      expect(text).toContain('55:00')
      expect(text).toContain('$2.50')
    })

    test('nothing is saved under the session being left', async ($, on) => {
      const fresh = usageOf({ cost: { usd: 0 } })
      const { store, land, clock } = resumable(on, fresh, usageOf())
      responds(on)
      on('session.end', ($, e) => ({ sessionId: e.sessionId }))
      await $.session.start(START)
      await $.session.end({ reason: 'resume', sessionId: 'fresh' } as any)
      await $.classic.SessionStart({ source: 'resume', session_id: 'resumed', seconds_since_last_response: 60 } as any)
      // A response before the switch lands still belongs to the resumed session.
      await step($)
      land()
      await clock.advance(400)
      expect(store.has('session:resumed')).toBe(true)
      expect((store.get('session:fresh') as any)?.cache).toBeUndefined()
    })

    test('a restart keeps the cache countdown; the cost is the engine\'s', async ($, on) => {
      const { clock } = world(on, () => usageOf({ cost: { usd: 1.23 } }))
      responds(on)
      await $.session.start(START)
      await step($)
      for (let i = 0; i < 10; i++) await clock.advance(60_000)
      await $.session.start(START)
      const text = await drawn($)
      expect(text).toContain('$1.23')
      expect(text).toContain('🧊 50:00')
    })

    test("a fresh process's first response waits for the limits to pick its TTL", async ($, on) => {
      let usage = usageOf({ rateLimits: [] })
      const { clock } = world(on, () => usage)
      responds(on)
      on('session.measure', ($, e) => ({ changed: e.changed }))
      await $.session.start(START)
      await step($)
      // No reading yet: 5 minutes is the guess, and an empty reading doesn't settle it.
      expect(await drawn($)).toContain('🧊 5:00')
      await $.session.measure({ context: usage.context, rateLimits: [], cost: usage.cost, changed: ['context'] } as any)
      await clock.advance(60_000)
      usage = usageOf()
      await $.session.measure({ context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost, changed: ['rateLimits'] } as any)
      expect(await drawn($)).toContain('🧊 59:00')
    })

    test('a restored countdown saved before its TTL was known takes it from the limits', async ($, on) => {
      const store = new Map<string, unknown>([
        ['session:sess-1', { savedAt: NOW - 120_000, cache: { touchedAt: NOW - 120_000, tokens: 9, ttlMs: 300_000, isTtlPending: true } }],
      ])
      world(on, () => usageOf(), () => 3, () => 'sess-1', store)
      await $.session.start(START)
      expect(await drawn($)).toContain('🧊 58:00')
    })

    test("claude --resume: the engine's expiry hint pins the TTL before any limit reading", async ($, on) => {
      const { clock } = world(on, () => usageOf({ rateLimits: [] }), () => 3, () => 'resumed')
      on('classic.SessionStart', () => ({}))
      on('session.measure', ($, e) => ({ changed: e.changed }))
      await $.classic.SessionStart({ source: 'resume', session_id: 'resumed', seconds_since_last_response: 600, prompt_cache_likely_expired: false } as any)
      await $.session.start(START)
      await $.session.measure({ context: usageOf().context, rateLimits: [], changed: ['context'] } as any)
      await clock.advance(1_000)
      expect(await drawn($)).toContain('🧊 49:59')
    })

    test('the TTL the API wrote the cache with wins over the guess', async ($, on) => {
      world(on, API_KEY_USAGE)
      responds(on, { ...CACHED, ephemeral_1h_input_tokens: 1_000, ephemeral_5m_input_tokens: 0 } as any)
      await $.session.start(START)
      await step($)
      expect(await drawn($)).toContain('🧊 60:00')
    })

    test('a hot reload does not count the cost twice', async ($, on) => {
      world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)
      await $.session.start(START)
      const text = await drawn($)
      expect(text).toContain('$1.23')
      expect(text).not.toContain('$2.46')
    })

    test('a new session starts from zero', async ($, on) => {
      let id = 'sess-1'
      let cost = 4.2
      world(on, () => usageOf({ cost: { usd: cost } }), () => 3, () => id)
      responds(on)
      await $.session.start(START)
      await step($)
      id = 'sess-2'
      cost = 0.01
      await $.session.start(START)
      const text = await drawn($)
      expect(text).toContain('$0.01')
      expect(text).toContain('🧊 —')
    })

    test('/clear starts the new session from zero', async ($, on) => {
      let id = 'sess-1'
      world(on, () => usageOf({ cost: { usd: id === 'sess-1' ? 4.2 : 0 } }), () => 3, () => id)
      responds(on)
      on('classic.SessionStart', () => ({}))
      await $.session.start(START)
      await step($)
      id = 'sess-2'
      await $.classic.SessionStart({ source: 'clear', session_id: 'sess-2' } as any)
      const text = await drawn($)
      expect(text).toContain('$0.00')
      expect(text).toContain('🧊 —')
    })
  })

  describe('useful extras', () => {
    const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

    test('the 5-hour pace, in percent per hour', async ($, on) => {
      world(on, () => usageOf())
      await $.session.start(START)
      // 38% used, 2h46m into the window.
      expect(await drawn($)).toContain('14%/h')
    })

    test('the 5-hour pace warns when the window runs out before its reset', async ($, on) => {
      const resetsAt = new Date(NOW + 4 * HOUR).toISOString()
      world(on, () => usageOf({ rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt }] }))
      await $.session.start(START)
      // 80% in its first hour: the rest goes in 15 minutes.
      expect(await drawn($)).toContain(`se agota ${Format.timeOfDay(NOW + 15 * 60_000)}`)
    })

    test("the re-cache cost shows only in the cache's last minutes", async ($, on) => {
      const { clock } = world(on, () => usageOf())
      responds(on)
      await $.session.start(START)
      await step($)
      for (let i = 0; i < 54; i++) await clock.advance(60_000)
      expect(await drawn($)).not.toContain('recalentar')
      await clock.advance(60_000)
      // 201,305 tokens of Opus 5.5 written for an hour: $4/MTok × 2.
      expect(await drawn($)).toContain('recalentar ~$1.61')
    })

    test('a 5-minute cache shows it from 2 minutes left, and once cold', async ($, on) => {
      const { clock } = world(on, API_KEY_USAGE)
      responds(on)
      await $.session.start(START)
      await step($)
      expect(await drawn($)).not.toContain('recalentar')
      for (let i = 0; i < 3; i++) await clock.advance(60_000)
      expect(await drawn($)).toContain('recalentar ~$1.01')
      for (let i = 0; i < 3; i++) await clock.advance(60_000)
      const text = await drawn($)
      expect(text).toContain('fría')
      expect(text).toContain('recalentar ~$1.01')
    })

    test("the turn's cost shows beside the total for a few seconds", async ($, on) => {
      let usd = 1.23
      const { clock } = world(on, () => usageOf({ cost: { usd } }))
      on('turn.start', ($, e) => ({ turnId: e.turnId }))
      on('turn.complete', () => ({ text: '' }))
      await $.session.start(START)
      await $.turn.start({ text: 'hola', turnId: 't2' })
      usd = 1.55
      await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: null } as any)
      expect(await drawn($)).toContain('$1.55 (+$0.32)')
      await clock.advance(3_100)
      expect(await drawn($)).not.toContain('(+$')
    })
  })
})
