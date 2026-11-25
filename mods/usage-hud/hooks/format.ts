// Text formatting for the HUD. Pure, no $.

/** 950, 12k, 221k, 1M, 1.2M */
export function tokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 || Number.isInteger(m) ? Math.round(m) : m.toFixed(1)}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

/** $0.42, $12.30, $123 */
export function money(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd)}`
  return `$${usd.toFixed(2)}`
}

/** 2h 14m, 14m 05s, 37s */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** 59:32, 4:05, 0:42 — a clock of minutes and seconds, as long as the hour lasts. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 6pm, 9:30am — the hour in local time. */
export function timeOfDay(ms: number): string {
  const d = new Date(ms)
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  const suffix = hours < 12 ? 'am' : 'pm'
  return minutes === 0 ? `${h12}${suffix}` : `${h12}:${String(minutes).padStart(2, '0')}${suffix}`
}

/** 12/10 6pm, 3/11 9:30am — day/month and hour in local time. */
export function resetDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}/${d.getMonth() + 1} ${timeOfDay(ms)}`
}

/** $0.42 for a cost estimate: a cent at least, so a tiny one doesn't read $0.00. */
export function approxMoney(usd: number): string {
  return `~${money(Math.max(usd, 0.01))}`
}
