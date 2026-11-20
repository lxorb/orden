import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => disk.current!.invoke(command, args),
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { busy } = await import('../../ui-kit/src/api')
const said = vi.spyOn(busy, 'failed').mockImplementation(() => undefined)
async function fresh(files: Record<string, string>) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add('/s')
  for (const [path, words] of Object.entries(files)) {
    d.files.set(path, words)
    const folder = path.slice(0, path.lastIndexOf('/'))
    if (folder !== '/s') d.folders.add(folder)
  }
  workspace.tabs = []
  workspace.undone.stack = []
  workspace.undone.ahead = []
  said.mockClear()
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
}
async function opened(path: string) {
  await workspace.open(path)
  const tab = workspace.tabs.find((one) => one.path === path)
  if (!tab) throw new Error(`${path} did not open`)
  return tab.note
}
type Note = Awaited<ReturnType<typeof opened>>
const at = (note: Note, head: number, typed = false, focused = true) => note.live.moved({ head, focused, typed })
function typed(note: Note, text: string, head = 3) {
  note.live.replace(text)
  at(note, head, true)
}
const files = () => [...d.files.keys()].sort()
const settled = async () => {
  await vi.waitFor(() => expect(workspace.writing).toBe(false))
  await workspace.writesSettled()
}
describe('a first heading the same as the file name', () => {
  test('renames the file once the caret leaves the heading, never while it is typed', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n\nWords\n' })
    const note = await opened('/s/Plan.md')
    const renaming = vi.spyOn(workspace, 'rename')
    at(note, 3)
    typed(note, '# Ro\n\nWords\n')
    typed(note, '# Road\n\nWords\n')
    await settled()
    expect(files()).toEqual(['/s/Plan.md'])
    expect(renaming).not.toHaveBeenCalled()
    at(note, 10)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Road.md']))
    await settled()
    expect(d.files.get('/s/Road.md')).toContain('# Road')
    expect(renaming).toHaveBeenCalledTimes(1)
    renaming.mockRestore()
  })
  test('renames when the note is closed with the caret still in its heading', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    typed(note, '# Road\n')
    const tab = workspace.tabs.find((one) => one.note === note)
    workspace.close(tab?.id ?? '')
    await vi.waitFor(() => expect(files()).toEqual(['/s/Road.md']))
  })
  test('with front matter above it, and the name leaves out what a file name may not hold', async () => {
    await fresh({ '/s/What Now.md': '---\ntags: [a]\n---\n# What? Now\n' })
    const note = await opened('/s/What Now.md')
    const line = note.live.text.toString().indexOf('# What')
    at(note, line + 3)
    typed(note, '---\ntags: [a]\n---\n# What? Then\n', line + 3)
    at(note, 0)
    await vi.waitFor(() => expect(files()).toEqual(['/s/What Then.md']))
    await settled()
    expect(d.files.get('/s/What Then.md')).toContain('# What? Then')
  })
  test('undone, done again and undone again, every step word for word', async () => {
    await fresh({ '/s/What Now.md': '# What? Now\n\nWords\n' })
    await workspace.rename('/s/What Now.md', 'Later.md')
    await settled()
    for (let round = 0; round < 2; round++) {
      await workspace.undoFileAction()
      await settled()
      expect([files(), d.files.get('/s/What Now.md')]).toEqual([['/s/What Now.md'], '# What? Now\n\nWords\n'])
      await workspace.redoFileAction()
      await settled()
      expect([files(), d.files.get('/s/Later.md')]).toEqual([['/s/Later.md'], '# Later\n\nWords\n'])
    }
  })
  test('a folder note renames its folder with it, one undo away', async () => {
    await fresh({ '/s/Trip/Trip.md': '# Trip\n' })
    const note = await opened('/s/Trip/Trip.md')
    at(note, 3)
    typed(note, '# Tour\n')
    at(note, 7)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Tour/Tour.md']))
    await workspace.undoFileAction()
    await vi.waitFor(() => expect(files()).toEqual(['/s/Trip/Trip.md']))
    expect(d.files.get('/s/Trip/Trip.md')).toContain('# Trip')
  })
  test('is not renamed onto a name already there, and says so', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n', '/s/Road.md': 'other\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    typed(note, '# Road\n')
    at(note, 7)
    await vi.waitFor(() => expect(said).toHaveBeenCalled())
    expect(String(said.mock.calls[0]?.[0])).toBe(
      'Could not rename Plan to Road: a note with that name already exists here.',
    )
    expect(files()).toEqual(['/s/Plan.md', '/s/Road.md'])
  })
  test('undone in the files, name and heading both come back', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    typed(note, '# Road\n')
    at(note, 7)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Road.md']))
    await workspace.undoFileAction()
    await vi.waitFor(() => expect(files()).toEqual(['/s/Plan.md']))
    await settled()
    expect(d.files.get('/s/Plan.md')).toContain('# Plan')
  })
  test('undone in the files, the heading comes back word for word, and done again as it was typed', async () => {
    await fresh({ '/s/What Now.md': '# What? Now\n' })
    const note = await opened('/s/What Now.md')
    at(note, 3)
    typed(note, '# What? Later\n')
    at(note, 14)
    await vi.waitFor(() => expect(files()).toEqual(['/s/What Later.md']))
    await settled()
    await workspace.undoFileAction()
    await vi.waitFor(() => expect(files()).toEqual(['/s/What Now.md']))
    await settled()
    expect(d.files.get('/s/What Now.md')).toBe('# What? Now\n')
    await workspace.redoFileAction()
    await vi.waitFor(() => expect(files()).toEqual(['/s/What Later.md']))
    await settled()
    expect(d.files.get('/s/What Later.md')).toBe('# What? Later\n')
  })
  test('an undo in the editor back in the heading names the file back', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    typed(note, '# Road\n')
    at(note, 7)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Road.md']))
    at(note, 3)
    typed(note, '# Plan\n')
    at(note, 7)
    await vi.waitFor(() => expect(files()).toEqual(['/s/Plan.md']))
  })
})
describe('a heading that is not the file name, or words that came from elsewhere', () => {
  test('a different heading changed leaves the name alone', async () => {
    await fresh({ '/s/Plan.md': '# Something else\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    typed(note, '# Road\n')
    at(note, 7)
    await settled()
    expect(files()).toEqual(['/s/Plan.md'])
  })
  test('a heading another device wrote is never a rename here', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    const note = await opened('/s/Plan.md')
    at(note, 3)
    note.live.replace('# Road\n')
    at(note, 7)
    await settled()
    expect(files()).toEqual(['/s/Plan.md'])
  })
})
describe('a file renamed', () => {
  test('takes a first heading of the same name along, open or not, front matter or not', async () => {
    await fresh({
      '/s/Plan.md': '# Plan\n\nWords\n',
      '/s/Trip.md': '---\na: 1\n---\n# Trip\nmore\n',
      '/s/Else.md': '# Something\n',
    })
    await opened('/s/Plan.md')
    await workspace.rename('/s/Plan.md', 'Road.md')
    await workspace.rename('/s/Trip.md', 'Tour.md')
    await workspace.rename('/s/Else.md', 'Other.md')
    await settled()
    expect(d.files.get('/s/Road.md')).toBe('# Road\n\nWords\n')
    expect(d.files.get('/s/Tour.md')).toBe('---\na: 1\n---\n# Tour\nmore\n')
    expect(d.files.get('/s/Other.md')).toBe('# Something\n')
  })
  test('undone, comes back word for word, what a name may not hold too, and done again it is as it was', async () => {
    await fresh({ '/s/What Now.md': '# What? Now\n' })
    await workspace.rename('/s/What Now.md', 'Later.md')
    await settled()
    expect(d.files.get('/s/Later.md')).toBe('# Later\n')
    await workspace.undoFileAction()
    await settled()
    expect(files()).toEqual(['/s/What Now.md'])
    expect(d.files.get('/s/What Now.md')).toBe('# What? Now\n')
    await workspace.redoFileAction()
    await settled()
    expect(files()).toEqual(['/s/Later.md'])
    expect(d.files.get('/s/Later.md')).toBe('# Later\n')
  })
  test('undone after the words under it were changed, keeps those words', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n\nWords\n' })
    await workspace.rename('/s/Plan.md', 'Road.md')
    await settled()
    d.files.set('/s/Road.md', '# Road\n\nWords and more\n')
    await workspace.undoFileAction()
    await settled()
    expect(d.files.get('/s/Plan.md')).toBe('# Plan\n\nWords and more\n')
  })
  test('outside Orden leaves the heading as it is', async () => {
    await fresh({ '/s/Plan.md': '# Plan\n' })
    await d.invoke('rename_note', { from: '/s/Plan.md', to: '/s/Road.md' })
    await workspace.fileMoved('/s/Plan.md', '/s/Road.md', 'file')
    await settled()
    expect(d.files.get('/s/Road.md')).toBe('# Plan\n')
  })
})
