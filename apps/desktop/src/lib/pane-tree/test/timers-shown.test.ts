import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'

const LIB = join(import.meta.dirname, '../..')
const SURFACES = [
  'ai-sidebar',
  'canvas',
  'chats-client',
  'explorer',
  'graph',
  'pages',
  'pass-ui',
  'reading',
  'settings',
  'tasks-views',
  'terminal',
  'time',
  'views',
  'web-tab',
]
const ALLOWED: Record<string, { count: number; why: string }> = {
  'time/src/reminding.ts': { count: 1, why: 'reminds of tracked time for the whole app, shown or not' },
  'time/src/start.svelte.ts': { count: 1, why: 'reconciles tracked time for the whole app' },
  'time/src/sense.svelte.ts': { count: 1, why: 'senses activity for the whole app' },
  'views/src/runner.svelte.ts': { count: 1, why: "runs every view's repeats in the background" },
  'chats-client/src/Bell.svelte': { count: 1, why: 'the bell is not in a tab' },
  'chats-client/src/socket.ts': { count: 1, why: "the connection's heartbeat" },
  'chats-client/src/view/Recorder.svelte': { count: 1, why: 'ticks only while a voice note is being recorded' },
}
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return (name.endsWith('.ts') || name.endsWith('.svelte')) && !name.endsWith('.test.ts') ? [path] : []
  })
}
test('a clock in a surface a pane keeps behind its tab ticks only while the tab is shown', () => {
  const found: Record<string, number> = {}
  for (const module of SURFACES) {
    for (const path of sources(join(LIB, module, 'src'))) {
      const count = readFileSync(path, 'utf8').match(/\bsetInterval\(/g)?.length ?? 0
      if (count) found[relative(LIB, path)] = count
    }
  }
  expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([path, one]) => [path, one.count])))
})
