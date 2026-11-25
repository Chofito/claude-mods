// Starts Claude Code with every mod (or the ones you name) loaded from this
// repo with --plugin-dir: saving a file hot-reloads the mod.
//   bun run dev                 all mods
//   bun run dev usage-hud       one mod
//   bun run dev -- --debug      extra flags after `--` go to claude

import { modPath, modsFrom } from './mods'

const args = process.argv.slice(2)
const split = args.indexOf('--')
const names = split === -1 ? args : args.slice(0, split)
const extra = split === -1 ? [] : args.slice(split + 1)

const flags = modsFrom(names).flatMap((m) => ['--plugin-dir', modPath(m)])
const proc = Bun.spawn(['claude', ...flags, ...extra], { stdio: ['inherit', 'inherit', 'inherit'] })
process.exit(await proc.exited)
