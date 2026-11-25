// API list prices, to estimate what re-caching the conversation costs once
// the prompt cache runs out. Pure. The session's own cost never comes from
// here: Claude Code totals it (`/cost`); this only prices a write that hasn't
// happened yet. Update the table when Anthropic's pricing page changes.

/** Base input price in USD per million tokens, by model id prefix (longest match wins). */
export const INPUT_USD_PER_MTOK: Record<string, number> = {
  'claude-fable-5-2': 8,
  'claude-mythos-5-2': 8,
  'claude-fable-5-1': 10,
  'claude-mythos-5-1': 10,
  'claude-fable-5': 10,
  'claude-mythos-5': 10,
  'claude-opus-5-5': 4,
  'claude-opus-5': 5,
  'claude-opus-4-8': 5,
  'claude-opus-4-7': 5,
  'claude-opus-4-6': 5,
  'claude-opus-4-5': 5,
  'claude-opus-4-1': 15,
  'claude-opus-4': 15,
  'claude-sonnet-5-5': 2,
  'claude-sonnet-5': 2,
  'claude-sonnet-4': 3,
  'claude-haiku-5-5': 0.1,
  'claude-haiku-4-5': 1,
  'claude-3-5-haiku': 0.8,
}

/** Haiku 5.5 charges more for prompts past 100K tokens. */
const LONG_PROMPT: Record<string, { above: number; usdPerMTok: number }> = {
  'claude-haiku-5-5': { above: 100_000, usdPerMTok: 0.5 },
}

/** A cache write costs the input price times this, by its TTL. */
export const CACHE_WRITE_MULTIPLIER = { '5m': 1.25, '1h': 2 } as const

/** The table's key for a model id as the API reports it (`anthropic.` prefixes, `[1m]` and date suffixes ignored). */
export function priceKeyOf(model: string): string | undefined {
  const id = model.toLowerCase().replace(/^.*?(claude-)/, '$1').replace(/\[.*\]$/, '')
  let best: string | undefined
  for (const key of Object.keys(INPUT_USD_PER_MTOK)) {
    if ((id === key || id.startsWith(`${key}-`) || id.startsWith(`${key}@`)) && key.length > (best?.length ?? 0)) best = key
  }
  return best
}

/** What writing `tokens` of prompt to the cache costs on `model`, or undefined for a model not in the table. */
export function cacheWriteUsd(model: string | undefined, tokens: number, ttlMs: number): number | undefined {
  if (!model) return undefined
  const key = priceKeyOf(model)
  if (!key) return undefined
  const long = LONG_PROMPT[key]
  const perMTok = long && tokens > long.above ? long.usdPerMTok : INPUT_USD_PER_MTOK[key]!
  const multiplier = ttlMs >= 60 * 60_000 ? CACHE_WRITE_MULTIPLIER['1h'] : CACHE_WRITE_MULTIPLIER['5m']
  return (tokens / 1_000_000) * perMTok * multiplier
}
