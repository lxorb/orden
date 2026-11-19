import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const { run } = await import('./actions')
const { CanvasStore } = await import('./store.svelte')
const { blankCanvas } = await import('@orden/markdown/canvas')
const { NoteDoc, Tab } = await import('../../documents/src/api')
const { workspace } = await import('../../workspace/src/api')

function boardInB(nodes: unknown[] = []) {
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/home/me/B/Board.canvas',
      name: 'Board.canvas',
      text: JSON.stringify({ ...JSON.parse(blankCanvas()), nodes }),
      dirty: false,
    },
    () => undefined,
  )
  return new CanvasStore(new Tab(note, 'pane'))
}

beforeEach(() => {
  vi.restoreAllMocks()
  workspace.spaces = [
    { id: 'a', name: 'A', root: '/home/me/A' },
    { id: 'b', name: 'B', root: '/home/me/B' },
  ]
  workspace.activeSpaceId = 'a'
})

test('a card turned into a note points at it relative to the canvas space', async () => {
  const store = boardInB([{ id: 'card', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'long words' }])
  vi.spyOn(workspace, 'noteFrom').mockResolvedValue('/home/me/B/Note.md')
  store.pick('card')

  await run.toNote(store, store.path)

  const card = store.canvas.nodes.find((node) => node.id === 'card')
  expect(card).toMatchObject({ type: 'file', file: 'Note.md' })
})

test('a note dropped on the canvas is named relative to the canvas space', async () => {
  const store = boardInB()

  await run.dropPaths(store, ['/home/me/B/Ideas.md'], { x: 0, y: 0 })

  expect(store.canvas.nodes).toMatchObject([{ type: 'file', file: 'Ideas.md' }])
})

test('a note from another space is not put on the canvas as a local path', async () => {
  const store = boardInB()

  await run.dropPaths(store, ['/home/me/A/Other.md'], { x: 0, y: 0 })

  expect(store.canvas.nodes).toEqual([])
})

test('a file card opens the file in the canvas space', async () => {
  const store = boardInB([{ id: 'card', type: 'file', x: 0, y: 0, width: 200, height: 80, file: 'Ideas.md' }])
  const opened = vi.spyOn(workspace, 'openEntry').mockResolvedValue(undefined)

  await run.open(store, { node: 'card', edge: null } as never, { x: 0, y: 0 })

  expect(opened).toHaveBeenCalledWith('/home/me/B/Ideas.md')
})
