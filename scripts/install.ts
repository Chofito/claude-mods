// Installs the mods for the CLI and the Desktop app.
//
//   bun run link            dev mode: adds each mod's directory to
//                           CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
//                           Every new session (CLI and Desktop) loads them
//                           straight from this repo, and saving hot-reloads.
//   bun run unlink          removes them from CLAUDE_CODE_PLUGIN_DIRS
//   bun run install-mods    stable mode: adds this repo as the `chofito-mods`
//                           marketplace and installs each mod from it. Run
//                           `claude plugin marketplace update chofito-mods`
//                           after you change a mod.
//
// Name mods to act on only those: bun run link usage-hud
// Another Claude config (e.g. a work account): set CLAUDE_CONFIG_DIR, as in
//   CLAUDE_CONFIG_DIR=~/.claude-work bun run link

import { $ } from 'bun'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { MARKETPLACE, modPath, modsFrom, ROOT } from './mods'

const SETTINGS = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
const [mode, ...names] = process.argv.slice(2)
const mods = modsFrom(names)

async function readSettings(): Promise<Record<string, any>> {
  const file = Bun.file(SETTINGS)
  return (await file.exists()) ? await file.json() : {}
}

async function editPluginDirs(change: (dirs: string[]) => string[]) {
  const settings = await readSettings()
  const env: Record<string, string> = { ...(settings.env ?? {}) }
  const before = (env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(delimiter).filter(Boolean)
  const after = change(before)
  if (after.length > 0) env.CLAUDE_CODE_PLUGIN_DIRS = after.join(delimiter)
  else delete env.CLAUDE_CODE_PLUGIN_DIRS
  settings.env = env
  // Back up once per run, then write.
  if (await Bun.file(SETTINGS).exists()) await Bun.write(`${SETTINGS}.bak`, Bun.file(SETTINGS))
  await Bun.write(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`CLAUDE_CODE_PLUGIN_DIRS = ${after.join(delimiter) || '(unset)'}`)
  console.log(`Saved ${SETTINGS} (backup in settings.json.bak). Start a new session, or /reload-plugins.`)
}

switch (mode) {
  case 'link':
    await editPluginDirs((dirs) => [...new Set([...dirs, ...mods.map(modPath)])])
    break
  case 'unlink':
    await editPluginDirs((dirs) => dirs.filter((d) => !mods.map(modPath).includes(d)))
    break
  case 'marketplace': {
    const known = await $`claude plugin marketplace list`.nothrow().text()
    if (!known.includes(MARKETPLACE)) await $`claude plugin marketplace add ${ROOT}`
    else await $`claude plugin marketplace update ${MARKETPLACE}`
    for (const mod of mods) await $`claude plugin install ${`${mod}@${MARKETPLACE}`}`
    console.log('Installed. Run /reload-plugins in open sessions.')
    break
  }
  default:
    console.error('usage: bun scripts/install.ts <link|unlink|marketplace> [mod...]')
    process.exit(1)
}
