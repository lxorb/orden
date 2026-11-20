import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command !== 'scan_links') return disk.current!.invoke(command, args)
    const { scanNote } = await import('@orden/scan/note')
    const notes = [...disk.current!.files].filter(([path]) => path.startsWith('/s/') && path.endsWith('.md'))
    return { notes: notes.map(([path, text]) => scanNote(path.slice('/s/'.length), text)), files: [] }
  },
}))
const { Disk } = await import('../../../../test/disk')
const d = new Disk()
disk.current = d
const { createEditor, undoEdit } = await import('@orden/editor')
type EditorView = ReturnType<typeof createEditor>
const { nameFromTitle } = await import('../../platform/src/api')
const { workspace } = await import('./workspace.svelte')
const { links } = await import('../../link-index/src/api')
const { startup } = await import('../../launch/src/api')
void startup.shown()
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
async function fresh(files: Record<string, string>) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add('/s')
  for (const [path, words] of Object.entries(files)) d.files.set(path, words)
  workspace.tabs = []
  workspace.undone.stack = []
  workspace.undone.ahead = []
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  await links.build('/s')
}
async function editing(path: string, at: number) {
  await workspace.open(path)
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} did not open`)
  const view = createEditor({ parent: document.body, shared: tab.note.live, selection: { anchor: at } })
  open.push(view)
  view.focus()
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return { tab, view }
}
function backspace(view: EditorView, times: number) {
  for (let one = 0; one < times; one++) {
    const at = view.state.selection.main.head
    view.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 }, userEvent: 'delete.backward' })
  }
}
function type(view: EditorView, words: string) {
  for (const letter of words) {
    const at = view.state.selection.main.head
    view.dispatch({ changes: { from: at, insert: letter }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
  }
}
const away = (view: EditorView) => view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
const files = () => [...d.files.keys()].filter((path) => path.endsWith('.md')).sort()
const settled = async () => {
  await vi.waitFor(() => expect(workspace.writing).toBe(false))
  await workspace.writesSettled()
}
describe('a title cleared and typed anew', () => {
  test('renames the note once the caret leaves, and the links follow', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n\nWords\n', '/s/Links.md': 'see [[Plan]]\n' })
    const { view } = await editing('/s/Plan.md', 6)
    backspace(view, 4)
    type(view, 'Roadmap')
    expect(files()).toEqual(['/s/Links.md', '/s/Plan.md'])
    away(view)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Links.md', '/s/Roadmap.md']))
    await settled()
    expect(d.files.get('/s/Links.md')).toBe('see [[Roadmap]]\n')
  })
  test('renames it when the tab is closed with the caret still in the title', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n\nWords\n' })
    const { tab, view } = await editing('/s/Plan.md', 6)
    backspace(view, 4)
    type(view, 'Roadmap')
    workspace.close(tab.id)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Roadmap.md']))
  })
  test('takes a name without what a name may not hold, and the heading keeps all of it', async () => {
    await fresh({ '/s/Odd.md': '# Odd\n' })
    const { view } = await editing('/s/Odd.md', 5)
    backspace(view, 3)
    type(view, 'Q3: plan/review?')
    away(view)
    const name = `${nameFromTitle('Q3: plan/review?') ?? ''}.md`
    await vi.waitFor(() => expect(files()).toEqual([`/s/${name}`]))
    await settled()
    expect(d.files.get(`/s/${name}`)).toBe('# Q3: plan/review?\n')
  })
  test('typed over a selection renames as well', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    const { view } = await editing('/s/Plan.md', 6)
    view.dispatch({ selection: { anchor: 2, head: 6 }, userEvent: 'select' })
    view.dispatch({ changes: { from: 2, to: 6, insert: 'Road' }, selection: { anchor: 6 }, userEvent: 'input.type' })
    away(view)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Road.md']))
  })
  test('a title that was not the name, cleared and typed anew, starts nothing', async () => {
    await fresh({ '/s/Plan.md': '# Something\n' })
    const { view } = await editing('/s/Plan.md', 11)
    backspace(view, 9)
    type(view, 'Road')
    away(view)
    await settled()
    expect(files()).toEqual(['/s/Plan.md'])
  })
})
describe('an undo in the editor', () => {
  test('back to the old title names the note back at once', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n\nWords\n' })
    const { view } = await editing('/s/Plan.md', 6)
    view.dispatch({ changes: { from: 2, to: 6, insert: 'Roadmap' }, selection: { anchor: 9 }, userEvent: 'input.type' })
    away(view)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Roadmap.md']))
    await settled()
    for (let step = 0; step < 5 && !view.state.doc.toString().startsWith('# Plan\n'); step++) undoEdit(view)
    expect(view.state.doc.toString()).toBe('# Plan\n\nWords\n')
    await vi.waitFor(() => expect(files()).toEqual(['/s/Plan.md']))
  })
})
