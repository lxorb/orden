import { expect, test, vi } from 'vitest'

/** A picture the account keeps names its whole address on the card (#364), and a double
 *  click on it goes there, the way a link card does, not to a path in the space. */

const opened = vi.hoisted(() => ({ hrefs: [] as string[], paths: [] as string[] }))

vi.mock('../open-link', () => ({
  openHref: (href: string) => opened.hrefs.push(href),
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { run } = await import('./actions')
const { CanvasStore } = await import('./store.svelte')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { workspace } = await import('../workspace.svelte')

const ADDRESS = 'https://orden.so/i/abc.png'

function board() {
  const file = (id: string, path: string) => ({
    id,
    type: 'file',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    file: path,
  })
  const text = JSON.stringify({ nodes: [file('kept', ADDRESS), file('note', 'a.md')], edges: [] })
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )
  return new CanvasStore(new Tab(note, 'pane'))
}

test('a card holding an address opens the address, and one holding a path the file', async () => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  vi.spyOn(workspace, 'openEntry').mockImplementation((path: string) => {
    opened.paths.push(path)
    return Promise.resolve()
  })
  const store = board()

  await run.open(store, { node: 'kept', edge: null } as never, { x: 0, y: 0 })
  expect(opened.hrefs).toEqual([ADDRESS])
  expect(opened.paths).toEqual([])

  await run.open(store, { node: 'note', edge: null } as never, { x: 0, y: 0 })
  expect(opened.paths).toEqual(['/space/a.md'])
})
