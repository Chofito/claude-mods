import { describe, expect, test } from 'claude-code/testing'

import { gradient, hsl, mix } from '../hooks/color'
import * as Format from '../hooks/format'
import { bar } from '../hooks/terminal'
import { cacheWriteUsd, priceKeyOf } from '../hooks/pricing'
import { CONTEXT_STOPS } from '../hooks/theme'

describe('format', () => {
  test('tokens', () => {
    expect(Format.tokens(950)).toBe('950')
    expect(Format.tokens(221_400)).toBe('221k')
    expect(Format.tokens(1_000_000)).toBe('1M')
    expect(Format.tokens(1_250_000)).toBe('1.3M')
  })

  test('money', () => {
    expect(Format.money(0.4)).toBe('$0.40')
    expect(Format.money(12.3)).toBe('$12.30')
    expect(Format.money(123.4)).toBe('$123')
  })

  test('clock', () => {
    expect(Format.clock(60 * 60_000)).toBe('60:00')
    expect(Format.clock(59 * 60_000 + 32_000)).toBe('59:32')
    expect(Format.clock(4 * 60_000 + 5_000)).toBe('4:05')
    expect(Format.clock(41_200)).toBe('0:42')
  })

  test('countdown', () => {
    expect(Format.countdown((2 * 3600 + 14 * 60) * 1000)).toBe('2h 14m')
    expect(Format.countdown((14 * 60 + 5) * 1000)).toBe('14m 05s')
    expect(Format.countdown(36_200)).toBe('37s')
  })

  test('reset date as day/month and 12-hour time', () => {
    expect(Format.resetDate(new Date(2026, 9, 12, 18).getTime())).toBe('12/10 6pm')
    expect(Format.resetDate(new Date(2026, 10, 3, 9, 30).getTime())).toBe('3/11 9:30am')
  })
})

describe('color', () => {
  test('mix and gradient', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(gradient(CONTEXT_STOPS, 0)).toBe(CONTEXT_STOPS[0]![1])
    expect(gradient(CONTEXT_STOPS, 100)).toBe(CONTEXT_STOPS[CONTEXT_STOPS.length - 1]![1])
    expect(hsl(0, 1, 0.5)).toBe('#ff0000')
  })

  test('the bar empties from the right with half-cell precision', () => {
    const cells = (remaining: number) => bar(remaining, 4, '#6aae78').map((s) => s.text).join('')
    expect(cells(100)).toBe('━━━━')
    expect(cells(50)).toBe('━━──')
    expect(cells(0)).toBe('────')
    expect(cells(62)).toBe('━━╸─')
  })
})

describe('pricing', () => {
  test('matches a model id by its longest known prefix', () => {
    expect(priceKeyOf('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(priceKeyOf('claude-opus-5-20260101')).toBe('claude-opus-5')
    expect(priceKeyOf('claude-opus-4-5-20251101')).toBe('claude-opus-4-5')
    expect(priceKeyOf('claude-opus-4-20250514')).toBe('claude-opus-4')
    expect(priceKeyOf('us.anthropic.claude-sonnet-4-6[1m]')).toBe('claude-sonnet-4')
    expect(priceKeyOf('gpt-x')).toBeUndefined()
  })

  test('a cache write costs 1.25× input for 5 minutes, 2× for an hour', () => {
    expect(Math.round(cacheWriteUsd('claude-opus-5-5', 1_000_000, 5 * 60_000)! * 1000)).toBe(Math.round(5 * 1000))
    expect(Math.round(cacheWriteUsd('claude-opus-5-5', 1_000_000, 60 * 60_000)! * 1000)).toBe(Math.round(8 * 1000))
    expect(Math.round(cacheWriteUsd('claude-haiku-5-5', 200_000, 5 * 60_000)! * 1000)).toBe(Math.round(0.125 * 1000))
    expect(cacheWriteUsd(undefined, 1, 1)).toBeUndefined()
  })
})
