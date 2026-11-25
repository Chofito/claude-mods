// Refreshes types/claude-code.d.ts, the mods API declarations the repo
// typechecks against. Prefers the copy Claude Code writes for your installed
// version (into a mod's .claude-plugin/types/ when it loads it: newer versions
// as types/claude-code/index.d.ts, older ones as types/claude-code.d.ts), and
// falls back to the one on GitHub, which can be older.

import { Glob } from 'bun'
import { join } from 'node:path'

import { MODS_DIR, ROOT } from './mods'

const TARGET = join(ROOT, 'types', 'claude-code.d.ts')
const GITHUB = 'https://raw.githubusercontent.com/anthropics/claude-code/main/mods/types/claude-code.d.ts'

const PATTERNS = ['*/.claude-plugin/types/claude-code/index.d.ts', '*/.claude-plugin/types/**/claude-code.d.ts']
const local = PATTERNS.flatMap((p) => [...new Glob(p).scanSync({ cwd: MODS_DIR, dot: true })])
if (local.length > 0) {
  const source = join(MODS_DIR, local[0]!)
  await Bun.write(TARGET, Bun.file(source))
  console.log(`types/claude-code.d.ts <- ${source}`)
} else {
  const res = await fetch(GITHUB)
  if (!res.ok) throw new Error(`GET ${GITHUB}: ${res.status}`)
  await Bun.write(TARGET, await res.text())
  console.log(`types/claude-code.d.ts <- ${GITHUB}`)
}
