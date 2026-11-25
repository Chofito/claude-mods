// Scaffolds a new mod and lists it in the marketplace:
//   bun run new my-mod "What it does"

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { MODS_DIR, ROOT } from './mods'

const [name, description = 'A Claude Code mod.'] = process.argv.slice(2)
if (!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
  console.error('usage: bun run new <kebab-case-name> ["description"]')
  process.exit(1)
}
const dir = join(MODS_DIR, name)
if (existsSync(dir)) {
  console.error(`mods/${name} already exists`)
  process.exit(1)
}

const files: Record<string, string> = {
  '.claude-plugin/plugin.json': `${JSON.stringify({ name, version: '0.1.0', description, author: { name: 'chofito' } }, null, 2)}\n`,
  'hooks/hooks.json': `${JSON.stringify({ modules: ['./register.ts'] }, null, 2)}\n`,
  'hooks/register.ts': `// ${name}: ${description}

import type { On } from 'claude-code'

export function register(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    return Text({ color: '#a8e6a1', children: ['hello from ${name}'] })
  })
}
`,
  'tests/register.test.ts': `import { describe, expect, test } from 'claude-code/testing'

describe('register', () => {
  test('draws above the prompt', async ($) => {
    const ui = await $.ui.mount({
      plugin: '${name}',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'band',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    } as any)
    expect(await ui.find({ type: 'Text', text: /hello/ })).toBeDefined()
  })
})
`,
  'README.md': `# ${name}\n\n${description}\n\n\`\`\`sh\nbun run dev ${name}\n\`\`\`\n`,
}

for (const [path, content] of Object.entries(files)) await Bun.write(join(dir, path), content)

const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json')
const marketplace = await Bun.file(marketplacePath).json()
marketplace.plugins.push({ name, source: `./mods/${name}`, description })
await Bun.write(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`)

console.log(`Created mods/${name} and listed it in .claude-plugin/marketplace.json`)
console.log(`Next: bun run dev ${name}`)
