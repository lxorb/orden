import { describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

const notes = new Map<string, string>()

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(
      command === 'read_note' && typeof args?.path === 'string'
        ? (notes.get(args.path) ?? '')
        : undefined,
    ),
}))

const { chosen, pick } = await import('./picking.svelte')
const { workspace } = await import('../../workspace/src/api')

const idOf = (name: string) => workspace.tabs.find((one) => one.shown === name)?.id ?? ''
const pickedNames = () => chosen.of(workspace.panes.focusedId).map((one) => one.shown)

describe('a pick', () => {
  test('stays put down when the tab that left it comes to the front again', async () => {
    workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
    workspace.activeSpaceId = 's'
    for (const name of ['A', 'B', 'C', 'D']) {
      notes.set(`/space/${name}.md`, `# ${name}`)
      await workspace.open(`/space/${name}.md`, { blank: true })
    }
    workspace.activate(idOf('A'))
    const front = pick(workspace.panes.focusedId, idOf('B'), 'toggle')
    if (front) workspace.activate(front)
    flushSync()
    expect(pickedNames()).toEqual(['A', 'B'])

    workspace.activate(idOf('D'))
    flushSync()
    workspace.activate(idOf('A'))
    flushSync()

    expect(pickedNames()).toEqual([])
  })
})
