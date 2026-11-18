import { describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: () => Promise.resolve(null),
}))

const { appMenuRows } = await import('./api')
const { flatten } = await import('./native-menu')
const { followDescribed } = await import('./native-menu-bar.svelte')
const { workspace } = await import('../../workspace/src/api')

const context = () => ({
  view: undefined,
  onpalette: () => undefined,
  onhistory: () => undefined,
  app: { view: undefined, palette: () => undefined, fullscreen: () => undefined },
})

describe('the menu bar', () => {
  test('follows the right sidebar and the full window, which it shows checked', async () => {
    workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.openBlank('A note', '# A\n')
    const seen: Record<string, boolean | undefined>[] = []
    const stop = followDescribed(await appMenuRows(), context, (described) => {
      const items = flatten(described.entries).flatMap((one) =>
        one.kind === 'item' ? [[one.text.toLowerCase(), one.checked] as const] : [],
      )
      seen.push(Object.fromEntries(items))
    })
    flushSync()
    expect(seen.at(-1)?.['right sidebar']).toBe(false)

    workspace.showPanel('outline')
    flushSync()
    expect(seen.at(-1)?.['right sidebar']).toBe(true)

    workspace.panes.fills = workspace.panes.focusedId
    flushSync()
    expect(seen.at(-1)?.['full window']).toBe(true)
    stop()
  })
})
