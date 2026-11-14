import { describe, expect, test, vi } from 'vitest'

const carried: { sources: string[]; folder: string; how: string }[] = []
vi.mock('./changes', () => ({
  carry: (_view: unknown, sources: string[], folder: string, how: string) => {
    carried.push({ sources, folder, how })
    return Promise.resolve()
  },
  changeable: () => true,
  freeName: (_taken: Set<string>, name: string) => name,
  takenNames: () => new Set(),
}))
vi.mock('../../workspace.svelte', () => ({
  workspace: { spaces: [{ root: '/home/me/Orden/Work' }], undone: { record: vi.fn() } },
}))

const { dragged, explorerDragged, isExplorerDrag, isTreeDrag, landing } =
  await import('../../drag-paths')
const { dropHow, dropInto, startDrag } = await import('./drag')

function transfer() {
  const data = new Map<string, string>()
  return {
    data,
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
    items: [],
    files: [],
  } as unknown as DataTransfer
}

function dragEvent(dataTransfer: DataTransfer, keys: Partial<DragEvent> = {}) {
  return {
    dataTransfer,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...keys,
  } as unknown as DragEvent
}

describe("a file explorer's drag", () => {
  test('carries its paths, and a file list drag too where all of them are in a space', () => {
    const outside = transfer()
    startDrag(dragEvent(outside), ['/home/me/Downloads/a.zip'])
    expect(isExplorerDrag(outside)).toBe(true)
    expect(isTreeDrag(outside)).toBe(false)
    expect(explorerDragged(outside)).toEqual(['/home/me/Downloads/a.zip'])
    expect(outside.getData('text/plain')).toBe('/home/me/Downloads/a.zip')

    const inside = transfer()
    startDrag(dragEvent(inside), ['/home/me/Orden/Work/plan.md'])
    expect(isTreeDrag(inside)).toBe(true)
    expect(dragged(inside)).toEqual(['/home/me/Orden/Work/plan.md'])
  })

  test('is copied into a space by the file list, as files from another app are', () => {
    const outside = transfer()
    startDrag(dragEvent(outside), ['/home/me/Downloads/a.zip'])
    expect(landing(dragEvent(outside), 'linux')).toBe('copy')
  })

  test('moves between explorers, and copies with Ctrl or out of a space', () => {
    const outside = transfer()
    startDrag(dragEvent(outside), ['/home/me/Downloads/a.zip'])
    expect(dropHow(dragEvent(outside))).toBe('move')
    expect(dropHow(dragEvent(outside, { ctrlKey: true }))).toBe('copy')
    const inside = transfer()
    startDrag(dragEvent(inside), ['/home/me/Orden/Work/plan.md'])
    expect(dropHow(dragEvent(inside))).toBe('copy')
    expect(dropHow(dragEvent(inside, { shiftKey: true }))).toBe('move')
  })

  test('lands in the folder it was let go over', () => {
    const outside = transfer()
    startDrag(dragEvent(outside), ['/home/me/Downloads/a.zip'])
    const prevent = vi.fn()
    dropInto({} as never, dragEvent(outside, { preventDefault: prevent }), '/home/me/Music')
    expect(prevent).toHaveBeenCalled()
    expect(carried).toEqual([
      { sources: ['/home/me/Downloads/a.zip'], folder: '/home/me/Music', how: 'move' },
    ])
  })
})
