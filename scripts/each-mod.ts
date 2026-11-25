// Runs `claude plugin validate` or `claude plugin test` on every mod (or the
// ones you name): bun run validate [mod...], bun run test [mod...]

import { $ } from 'bun'

import { modPath, modsFrom } from './mods'

const [action, ...names] = process.argv.slice(2)
if (action !== 'validate' && action !== 'test') {
  console.error('usage: bun scripts/each-mod.ts <validate|test> [mod...]')
  process.exit(1)
}

let failed = 0
for (const mod of modsFrom(names)) {
  console.log(`\n━━ ${action} ${mod}`)
  const result = await $`claude plugin ${action} ${modPath(mod)}`.nothrow()
  if (result.exitCode !== 0) failed++
}
process.exit(failed > 0 ? 1 : 0)
