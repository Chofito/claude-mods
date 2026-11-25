// Color math: hex <-> rgb, gradient stops and pastel HSL. Pure, no $.

export type Stop = readonly [at: number, hex: string]

type Rgb = [number, number, number]

function rgbOf(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function hexOf([r, g, b]: Rgb): string {
  const part = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Mixes two hex colors: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a)
  const y = rgbOf(b)
  const k = Math.max(0, Math.min(1, t))
  return hexOf([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k])
}

/** Color at `value` along sorted stops, blended between the two around it. */
export function gradient(stops: readonly Stop[], value: number): string {
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  if (value <= first[0]) return first[1]
  if (value >= last[0]) return last[1]
  for (let i = 1; i < stops.length; i++) {
    const [at, hex] = stops[i]!
    const [prevAt, prevHex] = stops[i - 1]!
    if (value <= at) return mix(prevHex, hex, (value - prevAt) / (at - prevAt))
  }
  return last[1]
}

/** HSL (h in degrees, s and l in 0..1) to hex. */
export function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return hexOf([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}

/** A pastel rainbow color for character `i` at time `ms`: the hue scrolls. */
export function rainbow(i: number, ms: number): string {
  return hsl(i * 28 - ms / 6, 0.75, 0.75)
}

/** 0..1..0 every `periodMs`, a smooth wave for pulses. */
export function wave(ms: number, periodMs: number): number {
  return (1 - Math.cos((2 * Math.PI * (ms % periodMs)) / periodMs)) / 2
}
