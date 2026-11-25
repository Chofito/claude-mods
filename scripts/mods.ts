// Shared helpers for the repo scripts: where the mods live and which exist.

import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dir, '..')
export const MODS_DIR = join(ROOT, 'mods')
export const MARKETPLACE = 'chofito-mods'

/** Every mod directory under mods/, or just the ones named on the command line. */
export function modsFrom(names: string[]): string[] {
  const all = readdirSync(MODS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  if (names.length === 0) return all
  const unknown = names.filter((n) => !all.includes(n))
  if (unknown.length > 0) {
    console.error(`Unknown mod(s): ${unknown.join(', ')}. Available: ${all.join(', ')}`)
    process.exit(1)
  }
  return names
}

export const modPath = (name: string) => join(MODS_DIR, name)
