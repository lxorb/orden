import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Every file operation said once, and everything kept by path following it.
 *
 *  What is under test is the promise workspace/file-ops.ts makes: an operation says
 *  what it did, once, and a store that keeps files by path follows every operation
 *  without a call to it written into any of them. So a store is made here that the
 *  app has never heard of, and it keeps up with a rename, a move into a folder note,
 *  an undo and a delete; and each store the app does have hears each operation
 *  exactly once.
 *
 *  The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { sync } = await import('./sync.svelte')
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')
const { keeping } = await import('./workspace/file-ops')
const { movedTo, within } = await import('./space-paths')
type FileOp = import('./workspace/file-ops').FileOp

const ROOT = '/space'

beforeEach(async () => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.files.set(`${ROOT}/Plan.md`, '# Plan\n')
  one.files.set(`${ROOT}/Idea.md`, '# Idea\n')
  one.files.set(`${ROOT}/Work/Notes.md`, '# Notes\n')
  one.folders.add(`${ROOT}/Work`)

  workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.panel = 'tree'
  workspace.undone.stack = []
  await workspace.loadTree()
})

describe('a store the app has never heard of', () => {
  /** What a store keeping something by path is: a label per file. It is told nothing
   *  by any operation; it only follows what is said. */
  function labels() {
    const kept = new Map<string, string>()
    const store = {
      moved(from: string, to: string) {
        for (const [path, label] of [...kept]) {
          const now = movedTo(path, from, to)
          if (now === null) continue
          kept.delete(path)
          kept.set(now, label)
        }
      },
      gone(path: string) {
        for (const one of [...kept.keys()]) if (within(path, one) !== null) kept.delete(one)
      },
    }
    const said: string[] = []
    const stop = [
      workspace.fileOps.follow(keeping(store)),
      workspace.fileOps.follow((op: FileOp) =>
        said.push(op.op === 'moved' ? `moved ${op.from} ${op.to}` : `${op.op} ${op.path}`),
      ),
    ]

    return { kept, said, stop: () => stop.forEach((one) => one()) }
  }

  test('follows a rename, a move into a folder note, an undo and a delete', async () => {
    const { kept, said, stop } = labels()
    kept.set(`${ROOT}/Plan.md`, 'plan')
    kept.set(`${ROOT}/Idea.md`, 'idea')
    kept.set(`${ROOT}/Work/Notes.md`, 'notes')

    try {
      await workspace.rename(`${ROOT}/Plan.md`, 'Goal.md')
      expect(kept.get(`${ROOT}/Goal.md`)).toBe('plan')

      // Onto a note, which becomes the folder it is drawn as: two moves, each said.
      await workspace.moveMany([`${ROOT}/Idea.md`], `${ROOT}/Goal`)
      expect(kept.get(`${ROOT}/Goal/Goal.md`)).toBe('plan')
      expect(kept.get(`${ROOT}/Goal/Idea.md`)).toBe('idea')

      // A folder that moves takes what is kept of everything in it.
      await workspace.rename(`${ROOT}/Work`, 'Desk')
      expect(kept.get(`${ROOT}/Desk/Notes.md`)).toBe('notes')

      await workspace.undoFileAction()
      expect(kept.get(`${ROOT}/Work/Notes.md`)).toBe('notes')

      await workspace.remove(`${ROOT}/Work/Notes.md`, false)
      expect(kept.has(`${ROOT}/Work/Notes.md`)).toBe(false)

      await workspace.undoFileAction()
      expect(disk.current?.files.has(`${ROOT}/Work/Notes.md`)).toBe(true)
    } finally {
      stop()
    }

    expect(said).toEqual([
      `moved ${ROOT}/Plan.md ${ROOT}/Goal.md`,
      `moved ${ROOT}/Goal.md ${ROOT}/Goal/Goal.md`,
      `moved ${ROOT}/Idea.md ${ROOT}/Goal/Idea.md`,
      `moved ${ROOT}/Work ${ROOT}/Desk`,
      `moved ${ROOT}/Desk ${ROOT}/Work`,
      `removed ${ROOT}/Work/Notes.md`,
      `created ${ROOT}/Work/Notes.md`,
    ])
  })

  test('and a document open inside a folder that moves goes with it', async () => {
    await workspace.open(`${ROOT}/Work/Notes.md`)
    await workspace.rename(`${ROOT}/Work`, 'Desk')

    expect(workspace.documents.map((one) => one.path)).toEqual([`${ROOT}/Desk/Notes.md`])
    expect(workspace.active?.name).toBe('Notes.md')
  })

  test('and a tab of a note beside a folder that went stays open', async () => {
    disk.current?.files.set(`${ROOT}/Workshop.md`, '# Workshop\n')
    await workspace.loadTree()
    await workspace.open(`${ROOT}/Workshop.md`)

    await workspace.remove(`${ROOT}/Work`, true)

    expect(workspace.tabs.map((one) => one.path)).toEqual([`${ROOT}/Workshop.md`])
  })
})

describe('a write in the air while a file moves', () => {
  /** Words typed and on their way down, the write asked for and held open until
   *  `land` is called: the round trip a write is, with a move landing inside it. */
  async function typedAndWriting(words: string) {
    const one = disk.current
    const original = one?.invoke
    if (!one || !original) throw new Error('no disk')

    let land = () => {
      // Replaced the moment the promise below hands over its resolver.
    }
    let asked = () => {
      // And this one by the next.
    }
    const landed = new Promise<void>((resolve) => (land = resolve))
    const writeAsked = new Promise<void>((resolve) => (asked = resolve))
    one.invoke = async (command, args) => {
      if (command === 'write_note') {
        one.invoke = original
        asked()
        await landed
      }
      return original(command, args)
    }

    workspace.active?.note.live.replace(words, true)
    const writing = workspace.writeNow()
    await writeAsked
    return { land, writing }
  }

  test('a note moved into a folder waits for it, and the words follow the note', async () => {
    await workspace.open(`${ROOT}/Plan.md`)
    const note = workspace.active?.note
    const { land, writing } = await typedAndWriting('# Plan\ntyped before the move\n')

    const moving = workspace.move(`${ROOT}/Plan.md`, `${ROOT}/Work`)
    land()
    await Promise.all([writing, moving])
    await workspace.writesSettled()

    // The move used to go ahead under the write: the file went, the write put the
    // newest words back at the old path, and the document was told the old path
    // back after it had followed the move - two files, and the tab on the stale one.
    expect(note?.path).toBe(`${ROOT}/Work/Plan.md`)
    expect(disk.current?.files.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(disk.current?.files.get(`${ROOT}/Work/Plan.md`)).toBe('# Plan\ntyped before the move\n')
  })

  test('and so does a folder renamed with a note open inside it', async () => {
    await workspace.open(`${ROOT}/Work/Notes.md`)
    const note = workspace.active?.note
    const { land, writing } = await typedAndWriting('# Notes\ntyped before the rename\n')

    const renaming = workspace.rename(`${ROOT}/Work`, 'Desk')
    land()
    await Promise.all([writing, renaming])
    await workspace.writesSettled()

    expect(note?.path).toBe(`${ROOT}/Desk/Notes.md`)
    expect(disk.current?.files.has(`${ROOT}/Work/Notes.md`)).toBe(false)
    expect(disk.current?.files.get(`${ROOT}/Desk/Notes.md`)).toBe(
      '# Notes\ntyped before the rename\n',
    )
  })

  test('and so does the undo of a move, which is a move back', async () => {
    await workspace.move(`${ROOT}/Plan.md`, `${ROOT}/Work`)
    await workspace.open(`${ROOT}/Work/Plan.md`)
    const note = workspace.active?.note
    const { land, writing } = await typedAndWriting('# Plan\ntyped before the undo\n')

    // The undo is fetched before it runs, so the write is let go a moment later:
    // long enough for a move back that did not wait to have happened.
    const undoing = workspace.undoFileAction()
    await new Promise((resolve) => setTimeout(resolve, 20))
    land()
    await Promise.all([writing, undoing])
    await workspace.writesSettled()

    expect(note?.path).toBe(`${ROOT}/Plan.md`)
    expect(disk.current?.files.has(`${ROOT}/Work/Plan.md`)).toBe(false)
    expect(disk.current?.files.get(`${ROOT}/Plan.md`)).toBe('# Plan\ntyped before the undo\n')
  })
})

describe('a note renamed while its heading is still its name', () => {
  test('has the new heading written to the file, not only shown', async () => {
    // With no file list on screen a new note is written at once under its
    // placeholder name, rather than waiting in a row for one.
    workspace.panel = null
    await workspace.createNote(ROOT)
    await workspace.writesSettled()
    const made = workspace.active?.path
    if (!made) throw new Error('no note')
    workspace.panel = 'tree'
    await workspace.loadTree()

    await workspace.rename(made, 'Groceries.md')
    await workspace.writesSettled()

    // The heading was rewritten quietly into a note with nothing waiting to be
    // written, which left it clean: the tab said `# Groceries` and the file kept
    // `# Untitled` until something else was typed.
    const shown = workspace.documentAt(`${ROOT}/Groceries.md`)?.text ?? ''
    expect(shown.startsWith('# Groceries\n')).toBe(true)
    expect(disk.current?.files.get(`${ROOT}/Groceries.md`)).toBe(shown)
  })
})

describe('a link rewritten in a note with typing not yet written', () => {
  test('keeps both the typing and the new link', async () => {
    disk.current?.files.set(`${ROOT}/Other.md`, 'see [[Plan]]\n')
    await workspace.loadTree()
    // The index waits its turn behind the first frame, which a test has to say has
    // been drawn; see startup.svelte.ts.
    void startup.shown()
    await links.build(ROOT)
    // This disk answers no scan, so the index hears of the two notes the way it
    // hears of a note written.
    links.noteSaved(`${ROOT}/Plan.md`, '# Plan\n')
    links.noteSaved(`${ROOT}/Other.md`, 'see [[Plan]]\n')
    await workspace.open(`${ROOT}/Other.md`)
    const note = workspace.active?.note
    note?.live.replace('see [[Plan]]\ntyped and waiting\n', true)

    await workspace.rename(`${ROOT}/Plan.md`, 'Goal.md')
    await workspace.writesSettled()

    // The rewrite went to the file and skipped the document, which had words of
    // its own; the typing then went down with the old link in it, over the new.
    expect(note?.text).toBe('see [[Goal]]\ntyped and waiting\n')
    expect(disk.current?.files.get(`${ROOT}/Other.md`)).toBe('see [[Goal]]\ntyped and waiting\n')
  })
})

describe('the stores the app keeps by path', () => {
  /** Each follower, by the call it answers an operation with. */
  function counted() {
    return {
      bookmarks: vi.spyOn(workspace.bookmarks, 'moved'),
      'folder icons': vi.spyOn(workspace.folderIcons, 'moved'),
      arranged: vi.spyOn(workspace.arranged, 'moved'),
      'left out': vi.spyOn(workspace.excluded, 'moved'),
      archive: vi.spyOn(workspace.archive, 'moved'),
      positions: vi.spyOn(workspace.positions, 'follow'),
      recents: vi.spyOn(workspace.device, 'follow'),
      closed: vi.spyOn(workspace.closed, 'follow'),
      index: vi.spyOn(links, 'follow'),
      account: vi.spyOn(sync, 'follow'),
    }
  }

  test('hear a rename exactly once each', async () => {
    const spies = counted()
    try {
      await workspace.rename(`${ROOT}/Plan.md`, 'Goal.md')

      for (const [store, spy] of Object.entries(spies)) {
        expect(spy.mock.calls.length, store).toBe(1)
      }
    } finally {
      vi.restoreAllMocks()
    }
  })

  test('and a delete exactly once each', async () => {
    const spies = {
      'folder icons': vi.spyOn(workspace.folderIcons, 'gone'),
      arranged: vi.spyOn(workspace.arranged, 'gone'),
      'left out': vi.spyOn(workspace.excluded, 'gone'),
      index: vi.spyOn(links, 'follow'),
      account: vi.spyOn(sync, 'follow'),
    }
    try {
      await workspace.remove(`${ROOT}/Idea.md`, false)

      for (const [store, spy] of Object.entries(spies)) {
        expect(spy.mock.calls.length, store).toBe(1)
      }
    } finally {
      vi.restoreAllMocks()
    }
  })

  test('and a space renamed exactly once each', async () => {
    const spies = {
      bookmarks: vi.spyOn(workspace.bookmarks, 'spaceMoved'),
      'folder icons': vi.spyOn(workspace.folderIcons, 'spaceMoved'),
      arranged: vi.spyOn(workspace.arranged, 'spaceMoved'),
      graph: vi.spyOn(workspace.graphSettings, 'spaceMoved'),
      'left out': vi.spyOn(workspace.excluded, 'spaceMoved'),
      archive: vi.spyOn(workspace.archive, 'spaceMoved'),
      recents: vi.spyOn(workspace.device, 'follow'),
      account: vi.spyOn(sync, 'follow'),
    }
    disk.current?.folders.add(ROOT)
    const original = disk.current?.invoke
    try {
      if (disk.current && original) {
        disk.current.invoke = (command, args) =>
          command === 'rename_space'
            ? Promise.resolve({ name: 'Studio', path: '/Studio' })
            : original(command, args)
      }
      await workspace.renameSpace('s', 'Studio')

      for (const [store, spy] of Object.entries(spies)) {
        expect(spy.mock.calls.length, store).toBe(1)
      }
    } finally {
      if (disk.current && original) disk.current.invoke = original
      vi.restoreAllMocks()
    }
  })
})
