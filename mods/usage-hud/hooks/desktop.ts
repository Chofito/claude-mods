// Draws the items in the Desktop app: a row of ring icons, rounded bars and
// text, all SVG where a proportional font would misalign characters. The
// animations live in the SVGs (SMIL), so the row redraws only when a value
// changes, not every frame.

import { mix } from './color'
import { barSvg, iconSvg, shakySvg, type SvgSpec } from './icons'
import { COLORS, DESKTOP_RIGHT, SIZES } from './theme'
import type { Item } from './view'

type Factory = (props: Record<string, unknown>) => unknown

function svg(Svg: Factory, spec: SvgSpec): unknown {
  // Sized up front: an Svg with no size is first laid out at a default, then shrinks.
  return Svg({ source: spec.source, alt: spec.alt, width: spec.width, height: spec.height })
}

function text(Text: Factory, children: string, color: string, bold = false): unknown {
  const props: Record<string, unknown> = { color, children }
  if (bold) props.bold = true
  return Text(props)
}

function itemOf(Box: Factory, Text: Factory, Svg: Factory, item: Item): unknown {
  const hot = item.id === 'turn' ? COLORS.turnFlash : COLORS.white
  const valueColor = item.glow > 0 ? mix(item.valueColor, hot, item.glow) : item.valueColor
  const children: unknown[] = [svg(Svg, iconSvg(item.id, item.accent, item.mood, SIZES.desktopIcon, item.fill, item.color))]
  if (item.label) children.push(text(Text, item.label, COLORS.label))
  if (item.remaining !== undefined) {
    const width = item.id === 'fiveHour' ? SIZES.desktopFiveHourBar : SIZES.desktopWeeklyBar
    children.push(svg(Svg, barSvg(item.remaining, item.color, item.mood, width, SIZES.desktopBarHeight)))
  }
  if (item.mood === 'party' && item.id === 'countdown') children.push(svg(Svg, shakySvg(item.value, 13)))
  else children.push(text(Text, item.value, valueColor, item.glow > 0 || item.mood === 'critical'))
  if (item.detail) children.push(text(Text, item.detail, COLORS.label))
  for (const extra of item.extras ?? []) children.push(text(Text, extra.text, extra.color))
  return Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children })
}

function group(Box: Factory, Text: Factory, Svg: Factory, items: readonly Item[]): unknown {
  return Box({ flexDirection: 'row', alignItems: 'center', columnGap: 3, children: items.map((item) => itemOf(Box, Text, Svg, item)) })
}

/**
 * One row: the counters at the left, the limit bars at the right edge
 * (DESKTOP_RIGHT). It wraps only when the window is too narrow for both.
 */
export function drawDesktop(Box: Factory, Text: Factory, Svg: Factory, items: readonly Item[]): unknown {
  if (items.length === 0) return undefined
  const left = items.filter((i) => !DESKTOP_RIGHT.includes(i.id))
  const right = items.filter((i) => DESKTOP_RIGHT.includes(i.id))
  const groups = [left, right].filter((g) => g.length > 0).map((g) => group(Box, Text, Svg, g))
  return Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 3,
    rowGap: 1,
    children: groups,
  })
}
