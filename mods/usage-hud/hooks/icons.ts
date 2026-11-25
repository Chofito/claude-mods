// Hand-drawn SVG icons and bars for the Desktop app: a 24×24 ring with a
// glyph inside, each animated with SMIL by the item's mood. Drawn as images
// (never `isInteractive`, whose frame starts at a default size and flashes):
// SMIL plays in an SVG image too. Pure strings, no $.

import { mix } from './color'
import { COLORS, type SegmentId } from './theme'
import type { Mood } from './view'

const RAINBOW = ['#f4a3a3', '#f6c890', '#f3e59b', '#a8e6a1', '#9fd8f0', '#c9b8f5', '#f4a3a3'].join(';')
const R = 10.25
const CIRCUMFERENCE = 2 * Math.PI * R

/** Glyphs drawn inside the ring, in the item's color. */
const GLYPHS: Record<SegmentId, string> = {
  // A speech bubble
  turn: '<path d="M7.6 8.2h8.8a1.6 1.6 0 0 1 1.6 1.6v4.3a1.6 1.6 0 0 1-1.6 1.6h-4.6l-2.9 2.3v-2.3H7.6A1.6 1.6 0 0 1 6 14.1V9.8a1.6 1.6 0 0 1 1.6-1.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  // Lines of text: what fills the context window
  context: '<path d="M8.5 9.5h7M8.5 12h7M8.5 14.5h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  // A stack of disks: the prompt cache
  cache:
    '<ellipse cx="12" cy="8.4" rx="4.6" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.4 8.4v7.2c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8V8.4M7.4 12c0 1 2.1 1.8 4.6 1.8s4.6-.8 4.6-1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  // A lightning bolt: the 5-hour budget
  fiveHour: '<path d="M13.2 6.2 8.4 12.9h3.4l-1 4.9 4.8-6.7h-3.4z" fill="currentColor"/>',
  // An hourglass: time to the reset
  countdown:
    '<g id="glass"><path d="M8.6 6.6h6.8M8.6 17.4h6.8M9.6 6.6c0 3 4.8 3.4 4.8 5.4s-4.8 2.4-4.8 5.4M14.4 6.6c0 3-4.8 3.4-4.8 5.4s4.8 2.4 4.8 5.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.4 16.6h3.2L12 14.6z" fill="currentColor"/></g>',
  // A calendar: the weekly window
  weekly:
    '<rect x="7" y="8" width="10" height="9" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 11h10M9.6 6.4v3M14.4 6.4v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // A dollar sign: the session's cost
  cost: '<path d="M14.6 9.6c-.5-.9-1.5-1.4-2.6-1.4-1.4 0-2.5.8-2.5 1.9 0 2.6 5.2 1.3 5.2 3.9 0 1.1-1.2 1.9-2.7 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.6v10.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
}

/** The animation an icon's whole drawing gets in each mood. */
function moodAnimation(id: SegmentId, mood: Mood): string {
  switch (mood) {
    case 'working':
      return '<animate attributeName="opacity" values="1;.55;1" dur="1.6s" repeatCount="indefinite"/>'
    case 'critical':
      return '<animate attributeName="opacity" values="1;.35;1" dur=".9s" repeatCount="indefinite"/>'
    case 'party':
      return '<animateTransform attributeName="transform" type="rotate" values="0 12 12;-12 12 12;12 12 12;-8 12 12;0 12 12" dur=".5s" repeatCount="indefinite"/>'
    case 'final':
      return id === 'countdown'
        ? ''
        : '<animate attributeName="opacity" values="1;.5;1" dur="1s" repeatCount="indefinite"/>'
    default:
      return ''
  }
}

export type SvgSpec = { source: string; alt: string; width: number; height: number }

/**
 * The ring icon of one item, in its accent. The context icon's ring is a
 * gauge: its arc fills with the window, in the state's `gauge` color.
 */
export function iconSvg(id: SegmentId, color: string, mood: Mood, size: number, fill?: number, gauge = color): SvgSpec {
  const party = mood === 'party'
  const stroke = party ? `<animate attributeName="stroke" values="${RAINBOW}" dur="1.2s" repeatCount="indefinite"/>` : ''
  const glyphColor = party ? `<animate attributeName="color" values="${RAINBOW}" dur="1.2s" repeatCount="indefinite"/>` : ''
  let ring: string
  if (id === 'context' && fill !== undefined) {
    const arc = (Math.max(0, Math.min(100, Math.round(fill))) / 100) * CIRCUMFERENCE
    ring =
      `<circle cx="12" cy="12" r="${R}" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-opacity=".3" stroke-width="1.6"/>` +
      `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${gauge}" stroke-width="1.8" stroke-linecap="round" ` +
      `stroke-dasharray="${arc.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 12 12)">${stroke}</circle>`
  } else {
    ring = `<circle cx="12" cy="12" r="${R}" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-width="1.6">${stroke}</circle>`
  }
  let glyph = GLYPHS[id]
  if (id === 'countdown' && mood === 'final') {
    // The hourglass flips over and over in the last minute.
    glyph = glyph.replace(
      '<g id="glass">',
      '<g id="glass"><animateTransform attributeName="transform" type="rotate" values="0 12 12;180 12 12;180 12 12" keyTimes="0;.35;1" dur="1.6s" repeatCount="indefinite"/>',
    )
  }
  const animation = moodAnimation(id, mood)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">` +
    `<g style="color:${color}">${glyphColor}${animation}${ring}${glyph}</g></svg>`
  return { source, alt: id, width: size, height: size }
}

/**
 * A rounded bar of what's left of a limit: the fill shrinks toward the left
 * as the window is used. Rainbow and flowing during a reset party; the fill
 * breathes when critical.
 */
export function barSvg(remaining: number, color: string, mood: Mood, width: number, height: number): SvgSpec {
  const r = height / 2
  const pct = Math.max(0, Math.min(100, Math.round(remaining)))
  const fillWidth = pct === 0 ? 0 : Math.max(height, (pct / 100) * width)
  // Unique per drawing: SVGs inlined in one page share an id namespace.
  const id = `uh-${mood}-${pct}-${color.slice(1)}`
  let defs: string
  let fill: string
  if (mood === 'party') {
    // Each stop cycles through the rainbow, a step behind the one before it, so the colors flow.
    const colors = RAINBOW.split(';').slice(0, -1)
    const stops = colors
      .map((_, i) => {
        const cycle = [...colors.slice(i), ...colors.slice(0, i), colors[i]].join(';')
        return `<stop offset="${(i / (colors.length - 1)).toFixed(2)}" stop-color="${colors[i]}"><animate attributeName="stop-color" values="${cycle}" dur="1.8s" repeatCount="indefinite"/></stop>`
      })
      .join('')
    defs = `<linearGradient id="${id}" x1="0" x2="1">${stops}</linearGradient>`
    fill = `<rect width="${width}" height="${height}" rx="${r}" fill="url(#${id})"/>`
  } else {
    defs = `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${mix(color, COLORS.white, 0.15)}"/><stop offset="1" stop-color="${color}"/></linearGradient>`
    const breathe = mood === 'critical' ? '<animate attributeName="opacity" values="1;.4;1" dur=".9s" repeatCount="indefinite"/>' : ''
    fill = fillWidth > 0 ? `<rect width="${fillWidth.toFixed(1)}" height="${height}" rx="${r}" fill="url(#${id})">${breathe}</rect>` : ''
  }
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<defs>${defs}</defs><rect width="${width}" height="${height}" rx="${r}" fill="#ffffff" fill-opacity=".08"/>${fill}</svg>`
  return { source, alt: `${pct}%`, width, height }
}

/** Rainbow text that shakes: the reset party's `¡RESET!`. */
export function shakySvg(text: string, height: number): SvgSpec {
  const width = Math.round(text.length * height * 0.62) + 8
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 4}" width="${width}" height="${height + 4}">` +
    `<text x="${width / 2}" y="${height}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${height}" font-weight="700" fill="#f4a3a3">` +
    `<animate attributeName="fill" values="${RAINBOW}" dur=".9s" repeatCount="indefinite"/>` +
    '<animateTransform attributeName="transform" type="translate" values="0 0;-1.5 .6;1.5 -.6;-1 -.6;1 .6;0 0" dur=".35s" repeatCount="indefinite"/>' +
    `${text}</text></svg>`
  return { source, alt: text, width, height: height + 4 }
}
