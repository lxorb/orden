import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

const NOT_YET = new Set([
  'lib/ai-providers/src/moves.ts',
  'lib/chats-client/src/hush.svelte.ts',
  'lib/chats-client/src/priorities.svelte.ts',
  'lib/crash-reports/src/watch.svelte.ts',
  'lib/explorer/src/pins.svelte.ts',
  'lib/history/src/recovery.svelte.ts',
  'lib/pass-sync/src/store.svelte.ts',
  'lib/protect/src/protection.svelte.ts',
  'lib/protect/src/unlocked.svelte.ts',
  'lib/terminal/src/shells.svelte.ts',
  'lib/theme-looks/src/wallpaper/wallpaper.svelte.ts',
  'lib/theme/src/theme.svelte.ts',
  'lib/usage/src/watch.svelte.ts',
  'lib/web-tab/src/permissions.svelte.ts',
  'lib/web-tab/src/search-engine.svelte.ts',
])

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

test('a store hears another window write its key through heardElsewhere, not a listener of its own', () => {
  const own = sources()
    .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    .filter((name) => name !== 'lib/platform/src/stored.ts' && !NOT_YET.has(name))
    .filter((name) =>
      /addEventListener\(\s*'storage'/.test(readFileSync(join(SOURCE, name), 'utf8')),
    )

  expect(own).toEqual([])
})
