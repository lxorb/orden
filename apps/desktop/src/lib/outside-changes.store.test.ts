import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))
vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'snapshot_note') versions.push(String(args?.content))
    if (command === 'write_note') writes.push(String(args?.content))
    return disk.current!.invoke(command, args)
  },
}))
const versions: string[] = []
const writes: string[] = []

const { Disk, memoryStorage } = await import('../../test/disk')
const d = new Disk()
disk.current = d
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { startAcross } = await import('./workspace/across')
await startAcross()
const { heardChange, heardNews } = await import('./workspace/outside.svelte')

const SPACE = '/s'

async function fresh(files: Record<string, string>) {
  await workspace.writesSettled()
  d.reset()
  d.folders.add(SPACE)
  for (const [path, words] of Object.entries(files)) d.files.set(path, words)
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.spaces = [{ id: 'S', name: 's', root: SPACE }]
  workspace.activeSpaceId = 'S'
  await workspace.loadTree()
  versions.length = 0
  writes.length = 0
}

function typed(words: string) {
  const note = workspace.active?.note
  if (!note) throw new Error('nothing open')
  const end = note.live.text.length
  note.live.edit([{ from: end, to: end, insert: words }], { userEvent: 'input' })
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('a stale buffer written over a file another program wrote', () => {
  test('a clean tab typed in keeps what the terminal wrote', async () => {
    await fresh({ '/s/n.md': '# n\n\nmine\n' })
    await workspace.open('/s/n.md')
    d.files.set('/s/n.md', '# n\n\nmine\n\nA WHOLE SECTION A TERMINAL AGENT WROTE\n')
    typed('typed\n')
    await workspace.writeNow()
    expect(d.files.get('/s/n.md')).toContain('TERMINAL AGENT')
    expect(d.files.get('/s/n.md')).toContain('typed')
    expect(workspace.active?.note.latest).toContain('TERMINAL AGENT')
    expect(workspace.active?.note.dirty).toBe(false)
  })

  test('both writing one line keeps both', async () => {
    await fresh({ '/s/n.md': 'one\n' })
    await workspace.open('/s/n.md')
    d.files.set('/s/n.md', 'one from outside\n')
    const note = workspace.active?.note
    note?.live.edit([{ from: 0, to: 3, insert: 'one from me' }], { userEvent: 'input' })
    await workspace.writeNow()
    expect(d.files.get('/s/n.md')).toContain('outside')
    expect(d.files.get('/s/n.md')).toContain('from me')
  })

  test('a file with Windows line endings no one else touched is written, not merged', async () => {
    await fresh({ '/s/n.md': 'one\r\ntwo\r\n' })
    await workspace.open('/s/n.md')
    typed('three\n')
    await workspace.writeNow()
    expect(d.files.get('/s/n.md')).toBe('one\ntwo\nthree\n')
    expect(versions[0]).toBe('one\r\ntwo\r\n')
  })

  test('a plane does not merge: the last write stands and a version holds the other', async () => {
    const plane = (nodes: string) => `{"nodes":[${nodes}],"edges":[]}`
    await fresh({ '/s/c.canvas': plane('') })
    await workspace.openCanvas('/s/c.canvas')
    const note = workspace.tabs.at(-1)?.note
    if (!note) throw new Error('not open')
    d.files.set('/s/c.canvas', plane('"outside"'))
    note.replace(plane('"mine"'))
    await workspace.writeNow()
    expect(d.files.get('/s/c.canvas')).toBe(plane('"mine"'))
    expect(versions).toContain(plane('"outside"'))
  })

  test('a file another program deleted does not come back, and the words stay', async () => {
    await fresh({ '/s/n.md': '# n\n' })
    await workspace.open('/s/n.md')
    d.files.delete('/s/n.md')
    typed('typed\n')
    await workspace.writeNow()
    expect(d.files.has('/s/n.md')).toBe(false)
    expect(workspace.active?.note.path).toBe(null)
    expect(workspace.active?.note.latest).toContain('typed')
  })

  test('a folder with no note of its own: the first words make the file, closed at once', async () => {
    await fresh({ '/s/Proj/other.md': 'x' })
    await workspace.openRow('/s/Proj')
    const tab = workspace.tabs.find((one) => one.path === '/s/Proj/Proj.md')
    if (!tab) throw new Error('did not open')
    tab.note.replace('words typed into the folder note')
    workspace.close(tab.id)
    await workspace.writesSettled()
    expect(d.files.get('/s/Proj/Proj.md')).toBe('words typed into the folder note')
  })

  test('a note the listing leaves out, closed within the pause, still writes', async () => {
    await fresh({ '/s/.hidden/n.md': 'x\n' })
    await workspace.loadTree()
    await workspace.open('/s/.hidden/n.md')
    const tab = workspace.tabs.find((one) => one.path === '/s/.hidden/n.md')
    if (!tab) throw new Error('did not open')
    tab.note.replace('x\ntyped\n')
    workspace.close(tab.id)
    await workspace.writesSettled()
    expect(d.files.get('/s/.hidden/n.md')).toBe('x\ntyped\n')
  })

  test('a note deleted with a key still owed is not written back', async () => {
    await fresh({ '/s/n.md': 'x\n' })
    await workspace.open('/s/n.md')
    typed('typed\n')
    await workspace.remove('/s/n.md', false)
    await workspace.writesSettled()
    expect(d.files.has('/s/n.md')).toBe(false)
  })
})

describe('the closed stack', () => {
  test('closed right after the last key, the file changed since: reopens from the file', async () => {
    await fresh({ '/s/a.md': '# a\n' })
    await workspace.open('/s/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('not open')
    typed('words typed then closed at once\n')
    workspace.close(tab.id)
    await workspace.writesSettled()
    expect(workspace.closed.stack.at(-1)?.draft.dirty).toBe(false)
    expect(workspace.closed.stack.at(-1)?.draft.doc).toBe('')

    const outside = '# a\nwords typed then closed at once\n\nFROM THE OTHER DEVICE\n'
    d.files.set('/s/a.md', outside)
    writes.length = 0
    await workspace.reopenClosed()
    await workspace.writesSettled()
    expect(workspace.tabs.at(-1)?.note.latest).toBe(outside)
    expect(writes).toEqual([])
    expect(d.files.get('/s/a.md')).toBe(outside)
  })

  test('a write that never landed: the words come back, and what the file says is kept', async () => {
    await fresh({ '/s/a.md': '# a\n' })
    workspace.closed.stack = [
      {
        paneId: workspace.panes.focusedId,
        at: 0,
        draft: {
          kind: 'note',
          path: '/s/a.md',
          name: 'a.md',
          doc: '# a\nTHE WORDS THE CLOSED STACK SAVED\n',
          dirty: true,
          cursor: 0,
          scroll: 0,
        },
      },
    ]
    d.files.set('/s/a.md', '# a\nFROM THE OTHER DEVICE\n')
    await workspace.reopenClosed()
    await workspace.writesSettled()
    expect(workspace.active?.note.latest).toContain('THE WORDS THE CLOSED STACK SAVED')
    expect(d.files.get('/s/a.md')).toContain('THE WORDS THE CLOSED STACK SAVED')
    expect(versions).toContain('# a\nFROM THE OTHER DEVICE\n')
  })

  test('words still unwritten when the tab comes back at once are all there', async () => {
    await fresh({ '/s/a.md': '# a\n' })
    await workspace.open('/s/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('not open')
    typed('just typed\n')
    workspace.close(tab.id)
    await workspace.reopenClosed()
    await workspace.writesSettled()
    expect(workspace.tabs.at(-1)?.note.latest).toBe('# a\njust typed\n')
    expect(d.files.get('/s/a.md')).toBe('# a\njust typed\n')
  })

  test('a refused write leaves the words on the entry', async () => {
    await fresh({ '/s/a.md': '# a\n' })
    await workspace.open('/s/a.md')
    const tab = workspace.active
    if (!tab) throw new Error('not open')
    d.unreadable.add('/s/a.md')
    typed('kept\n')
    workspace.close(tab.id)
    await vi.waitFor(() => expect(workspace.closed.stack.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(workspace.closed.stack.at(-1)?.draft.dirty).toBe(true)
    expect(workspace.closed.stack.at(-1)?.draft.doc).toContain('kept')
    d.unreadable.clear()
    await workspace.writesSettled()
  })
})

describe('what the watch says, with no engine to hear it', () => {
  const stat = { size: 1, mtime: 1, id: null, dir: false }
  const modified = (path: string) => ({ kind: 'modified' as const, path, ...stat })

  test('a clean tab reads the file, and writes nothing', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    d.files.set('/s/n.md', 'mine\nAND THEIRS\n')
    await heardChange(modified('/s/n.md'))
    expect(workspace.active?.note.latest).toBe('mine\nAND THEIRS\n')
    expect(workspace.active?.note.dirty).toBe(false)
    await workspace.writesSettled()
    expect(writes).toEqual([])
  })

  test("the watch saying back this window's own write changes nothing", async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    typed('typed\n')
    await workspace.writesSettled()
    writes.length = 0
    const revision = workspace.active?.note.revision
    await heardChange(modified('/s/n.md'))
    await workspace.writesSettled()
    expect(workspace.active?.note.revision).toBe(revision)
    expect(writes).toEqual([])
  })

  test('words waiting take the file in as they go down', async () => {
    await fresh({ '/s/n.md': 'one\n\ntwo\n' })
    await workspace.open('/s/n.md')
    typed('typed\n')
    d.files.set('/s/n.md', 'THEIRS\n\none\n\ntwo\n')
    await heardChange(modified('/s/n.md'))
    await workspace.writesSettled()
    expect(d.files.get('/s/n.md')).toBe('THEIRS\n\none\n\ntwo\ntyped\n')
    expect(workspace.active?.note.latest).toBe('THEIRS\n\none\n\ntwo\ntyped\n')
  })

  test('a file gone closes a clean tab', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    d.files.delete('/s/n.md')
    await heardChange({ kind: 'removed', path: '/s/n.md', dir: false, id: null })
    expect(workspace.tabs).toEqual([])
    await workspace.writesSettled()
    expect(d.files.has('/s/n.md')).toBe(false)
  })

  test('a file gone keeps a tab with words on no disk, as a draft', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    typed('typed\n')
    d.files.delete('/s/n.md')
    await heardChange({ kind: 'removed', path: '/s/n.md', dir: false, id: null })
    await workspace.writesSettled()
    expect(workspace.active?.note.path).toBe(null)
    expect(workspace.active?.note.latest).toContain('typed')
    expect(d.files.has('/s/n.md')).toBe(false)
  })

  test('a file said gone that is back stays', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    await heardChange({ kind: 'removed', path: '/s/n.md', dir: false, id: null })
    expect(workspace.active?.path).toBe('/s/n.md')
  })

  test('a file moved takes its tab along, and a key lands at the new name', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    await workspace.open('/s/n.md')
    d.files.delete('/s/n.md')
    d.files.set('/s/m.md', 'mine\n')
    await heardChange({ kind: 'renamed', from: '/s/n.md', path: '/s/m.md', ...stat })
    expect(workspace.active?.path).toBe('/s/m.md')
    typed('typed\n')
    await workspace.writesSettled()
    expect(d.files.get('/s/m.md')).toBe('mine\ntyped\n')
    expect(d.files.has('/s/n.md')).toBe(false)
  })

  test('a new file is a row in the list', async () => {
    await fresh({ '/s/n.md': 'mine\n' })
    d.files.set('/s/fresh.md', 'from git\n')
    await heardNews({
      root: SPACE,
      changes: [{ kind: 'created', path: '/s/fresh.md', ...stat }],
      scan: false,
      gone: false,
    })
    await vi.waitFor(() => expect(workspace.entryAt('/s/fresh.md')).not.toBeNull())
  })

  test("a move of the workspace's own, said back, leaves the steps as they were", async () => {
    await fresh({ '/s/x.md': 'x\n' })
    await workspace.rename('/s/x.md', 'y.md')
    await heardChange({ kind: 'renamed', from: '/s/x.md', path: '/s/y.md', ...stat })
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/s/x.md'])
  })
})

describe('from the review', () => {
  const stat = { size: 1, mtime: 1, id: null, dir: false }
  const renamed = (from: string, path: string) => ({
    kind: 'renamed' as const,
    from,
    path,
    ...stat,
  })
  const removed = (path: string) => ({ kind: 'removed' as const, path, dir: false, id: null })

  test('words only a closed tab holds outlive the file going, heard or not', async () => {
    for (const heard of [true, false]) {
      await fresh({ '/s/n.md': 'old\n' })
      await workspace.open('/s/n.md')
      const tab = workspace.active
      if (!tab) throw new Error('not open')
      d.unreadable.add('/s/n.md')
      typed('PRECIOUS\n')
      workspace.close(tab.id)
      d.unreadable.clear()
      d.files.delete('/s/n.md')
      if (heard) await heardChange(removed('/s/n.md'))
      else await workspace.fileGone('/s/n.md', 'file')
      await workspace.reopenClosed()
      expect(workspace.tabs.at(-1)?.note.latest).toContain('PRECIOUS')
      expect(workspace.tabs.at(-1)?.note.path).toBe(null)
      await workspace.writesSettled()
      expect(d.files.has('/s/n.md')).toBe(false)
    }
  })

  test('a write from another document at the path does not spend the words of the first', async () => {
    await fresh({ '/s/n.md': 'old\n' })
    workspace.closed.stack = [
      {
        paneId: workspace.panes.focusedId,
        at: 0,
        draft: {
          kind: 'note',
          path: '/s/n.md',
          name: 'n.md',
          doc: 'old\nPRECIOUS\n',
          dirty: true,
          cursor: 0,
          scroll: 0,
          share: 'a document long gone',
        },
      },
    ]
    await workspace.open('/s/n.md')
    typed('other\n')
    await workspace.writesSettled()
    expect(workspace.closed.stack.at(-1)?.draft.doc).toContain('PRECIOUS')
  })

  test('a rename said back through another window leaves its own step whole', async () => {
    await fresh({ '/s/x.md': 'x\n' })
    await workspace.rename('/s/x.md', 'y.md')
    await workspace.fileOps.tell({
      op: 'moved',
      from: '/s/x.md',
      to: '/s/y.md',
      kind: 'file',
      root: SPACE,
      heard: true,
    })
    await workspace.undoFileAction()
    expect([...d.files.keys()]).toEqual(['/s/x.md'])
  })

  test('seventy notes moved in one burst all go back', async () => {
    const files: Record<string, string> = {}
    for (let at = 0; at < 70; at++) files[`/s/n${String(at)}.md`] = 'n\n'
    await fresh({ ...files, '/s/in/keep.md': 'k\n' })
    const paths = Object.keys(files)
    await workspace.moveMany(paths, '/s/in')
    for (const path of paths) {
      await heardChange(renamed(path, `/s/in/${path.slice(3)}`))
    }
    await workspace.undoFileAction()
    for (const path of paths) expect(d.files.has(path)).toBe(true)
  })

  test('a move still under way is not taken for another program', async () => {
    await fresh({ '/s/w.md': 'w\n' })
    await workspace.rename('/s/w.md', 'x.md')
    const { moving } = await import('./views/moving')
    const heard: string[] = []
    const stop = workspace.fileOps.follow((op) => heard.push(op.op))
    await moving('/s/y.md', async () => {
      d.files.set('/s/y.md', d.files.get('/s/x.md') ?? '')
      d.files.delete('/s/x.md')
      await heardChange(renamed('/s/x.md', '/s/y.md'))
    })
    stop()
    expect(heard).toEqual([])
  })

  test('a move there and back with nothing said leaves a later move outside heard', async () => {
    await fresh({ '/s/a.md': 'a\n' })
    await workspace.open('/s/a.md')
    await workspace.rename('/s/a.md', 'b.md')
    await workspace.rename('/s/b.md', 'a.md')
    d.files.delete('/s/a.md')
    d.files.set('/s/b.md', 'a\n')
    await heardChange(renamed('/s/a.md', '/s/b.md'))
    expect(workspace.active?.path).toBe('/s/b.md')
  })

  test('a file that vanishes outside and returns has lost nothing kept by path', async () => {
    await fresh({ '/s/n.md': 'n\n' })
    await workspace.open('/s/n.md')
    workspace.folderIcons.set('/s/n.md', 'star')
    const heard: string[] = []
    const stop = workspace.fileOps.follow((op) => heard.push(op.op))
    d.files.delete('/s/n.md')
    await heardChange(removed('/s/n.md'))
    stop()
    expect(heard).toEqual([])
    expect(workspace.tabs).toEqual([])
    expect(workspace.folderIcons.iconOf('/s/n.md')).toBe('star')

    d.files.set('/s/n.md', 'n\n')
    await workspace.reopenClosed()
    expect(workspace.active?.path).toBe('/s/n.md')
  })
})

describe('the highlights beside a PDF, changed by another program', () => {
  const stat = { size: 1, mtime: 1, id: null, dir: false }

  test('tell the pages of that PDF, whether written, made or deleted', async () => {
    const { marksFromOutside } = await import('./pdf/src/api')
    const before = marksFromOutside('/s/Paper.pdf')

    await heardChange({ kind: 'modified', path: '/s/Paper.pdf.highlights.json', ...stat })
    await heardChange({ kind: 'created', path: '/s/Paper.pdf.highlights.json', ...stat })
    await heardChange({
      kind: 'removed',
      path: '/s/Paper.pdf.highlights.json',
      dir: false,
      id: null,
    })
    await heardChange({ kind: 'modified', path: '/s/Paper.pdf', ...stat })

    expect(marksFromOutside('/s/Paper.pdf')).toBe(before + 3)
  })
})

describe('a PDF changed by another program', () => {
  const stat = { size: 1, mtime: 1, id: null, dir: false }
  const AT = { file: 'Paper.pdf', note: '/s/Paper.pages', root: '/s' }

  test('tells the page notes drawing it to draw it again, and nothing for its highlights', async () => {
    const { paperEdition } = await import('./pages/paper')
    const before = paperEdition(AT)

    await heardChange({ kind: 'modified', path: '/s/Paper.pdf.highlights.json', ...stat })
    await heardChange({ kind: 'modified', path: '/s/Other.pdf', ...stat })
    await vi.waitFor(() => expect(paperEdition({ ...AT, file: 'Other.pdf' })).toBe(1))
    expect(paperEdition(AT)).toBe(before)

    await heardChange({ kind: 'modified', path: '/s/Paper.pdf', ...stat })
    await vi.waitFor(() => expect(paperEdition(AT)).toBe(before + 1))
    await heardChange({ kind: 'removed', path: '/s/Paper.pdf', dir: false, id: null })
    await heardChange({ kind: 'created', path: '/s/Paper.pdf', ...stat })
    await vi.waitFor(() => expect(paperEdition(AT)).toBe(before + 2))
  })
})
