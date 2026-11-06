import { beforeEach, describe, expect, test, vi } from 'vitest'

const sent: { command: string; path: string; content: string }[] = []

const refused = new Set<string>()

const disk = new Map<string, string>()

const restores = new Map<string, string>()

const trees = new Map<string, unknown>()

vi.mock('../tauri', () => ({
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    const id = typeof args?.id === 'string' ? args.id : ''
    sent.push({ command, path, content })

    if (command === 'read_tree') {
      const root = typeof args?.root === 'string' ? args.root : ''
      const tree = trees.get(root)
      return tree ? Promise.resolve(tree) : Promise.reject(new Error('root is not a directory'))
    }
    const named = path || id
    if (refused.has(named) || refused.has(`${command} ${named}`))
      return Promise.reject(new Error(`${named} will not budge`))
    if (command === 'restore_trash') return Promise.resolve(restores.get(id) ?? '')
    if (command === 'read_note') return Promise.resolve(disk.get(path) ?? '')
    if (command === 'file_stamp') return Promise.resolve(disk.has(path) ? { modified: 0 } : '')
    return Promise.resolve('')
  },
}))

const told: string[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void told.push(`saved ${path}`),
  },
}))

const { accountHoldsAll, undoLastFileAction } = await import('./undoing')
const { redoLastFileAction } = await import('./redoing')
const { FileActions } = await import('./undo.svelte')
type PutsBack = import('./undoing').PutsBack
type FileAction = import('./undo.svelte').FileAction

function store(action: FileAction): PutsBack & { loaded: number; wrote: number } {
  const undone = new FileActions()
  undone.record(action)

  const kept = {
    undone,
    documentAt: () => null,
    entryAt: () => null,
    fileMoved: (from: string, to: string) => {
      told.push(`moved ${from} -> ${to}`)
      return Promise.resolve()
    },
    fileGone: (path: string) => {
      told.push(`gone ${path}`)
      return Promise.resolve()
    },
    fileCame: (path: string) => {
      told.push(`back ${path}`)
      return Promise.resolve()
    },
    reload: (path: string) => void told.push(`reloaded ${path}`),
    holdingUnder: (_path: string, run: () => Promise<void>) => run(),
    renameOnDisk: async (from: string, to: string) => {
      const { invoke } = await import('../tauri')
      await invoke('rename_note', { from, to })
    },
    bin: (path: string, folder: boolean) => {
      told.push(folder ? `binned folder ${path}` : `binned ${path}`)
      return Promise.resolve({ content: '# new', trashId: `t-${path}` })
    },
    retarget: (from: string, to: string) => {
      told.push(`retargeted ${from} -> ${to}`)
      return Promise.resolve(1)
    },
    loadTree: () => {
      kept.loaded += 1
      return Promise.resolve()
    },
    persist: () => {
      kept.wrote += 1
    },
    loaded: 0,
    wrote: 0,
  }

  return kept as unknown as PutsBack & { loaded: number; wrote: number }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  refused.clear()
  disk.clear()
  restores.clear()
})

describe('an entry that goes back', () => {
  test('comes off the stack, and the rows and the strip are written again', async () => {
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    await undoLastFileAction(ws)

    expect(sent).toEqual([
      { command: 'file_stamp', path: '/s/a.md', content: '' },
      { command: 'read_tree', path: '', content: '' },
      { command: 'write_note', path: '/s/a.md', content: '# a' },
    ])
    expect(ws.undone.stack).toEqual([])
    expect(ws.loaded).toBe(1)
    expect(ws.wrote).toBe(1)
  })

  test('and nothing at all happens where the stack is empty', async () => {
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    ws.undone.drop()
    await undoLastFileAction(ws)

    expect(sent).toEqual([])
    expect(ws.loaded).toBe(0)
  })
})

describe('an entry that cannot go back', () => {
  test('stays on the stack, so the same undo can be asked for again', async () => {
    refused.add('/s/a.md')
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a' })
    await undoLastFileAction(ws)

    expect(ws.undone.stack).toHaveLength(1)
    expect(ws.loaded).toBe(0)
    expect(told).toEqual([])
  })

  test('and a deletion with nothing kept says so rather than writing nothing', async () => {
    const ws = store({ kind: 'delete', path: '/s/paper.pdf', content: '' })
    await undoLastFileAction(ws)

    expect(sent).toEqual([])
    expect(ws.undone.stack).toHaveLength(1)
  })

  test('and a deletion the trash refuses falls back to the snapshot', async () => {
    refused.add('trash-1')
    const ws = store({ kind: 'delete', path: '/s/a.md', content: '# a', trashId: 'trash-1' })
    await undoLastFileAction(ws)

    expect(sent.map((one) => one.command)).toEqual([
      'restore_trash',
      'file_stamp',
      'read_tree',
      'write_note',
    ])
    expect(ws.undone.stack).toEqual([])
  })
})

describe('a replacement put back', () => {
  const NOTE = {
    content: 'alpha beta',
    after: 'gamma beta',
    edits: [{ from: 0, to: 5, insert: 'alpha' }],
  }

  test('puts the old words back in every note', async () => {
    disk.set('/s/a.md', NOTE.after)
    disk.set('/s/b.md', NOTE.after)
    const ws = store({
      kind: 'replace',
      notes: [
        { path: '/s/a.md', ...NOTE },
        { path: '/s/b.md', ...NOTE },
      ],
    })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: '/s/a.md', content: NOTE.content },
      { command: 'write_note', path: '/s/b.md', content: NOTE.content },
    ])
    expect(ws.undone.stack).toEqual([])
  })

  test('and leaves it alone where a note will not read', async () => {
    disk.set('/s/a.md', NOTE.after)
    refused.add('read_note /s/b.md')
    const ws = store({
      kind: 'replace',
      notes: [
        { path: '/s/a.md', ...NOTE },
        { path: '/s/b.md', ...NOTE },
      ],
    })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    expect(ws.undone.last?.kind).toBe('replace')
  })
})

describe('an import taken back', () => {
  const hashOf = async (words: string) => (await import('../bytes')).sha256(words)

  test('steps over the one file that will not go and removes the rest', async () => {
    refused.add('delete_note /s/b.md')
    for (const path of ['/s/a.md', '/s/b.md', '/s/c.md']) disk.set(path, '# imported')
    const wrote = await hashOf('# imported')
    const ws = store({
      kind: 'import',
      paths: ['/s/a.md', '/s/b.md', '/s/c.md'],
      wrote: { '/s/a.md': wrote, '/s/b.md': wrote, '/s/c.md': wrote },
    })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'delete_note').map((one) => one.path)).toEqual([
      '/s/a.md',
      '/s/b.md',
      '/s/c.md',
    ])
    expect(told).toEqual(['gone /s/a.md', 'gone /s/c.md'])
    expect(ws.undone.stack).toEqual([])
  })

  test('and keeps a note that has been written in since', async () => {
    disk.set('/s/a.md', '# imported')
    disk.set('/s/b.md', '# imported\n\na week of notes')
    const wrote = await hashOf('# imported')
    const ws = store({
      kind: 'import',
      paths: ['/s/a.md', '/s/b.md'],
      wrote: { '/s/a.md': wrote, '/s/b.md': wrote },
    })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'delete_note').map((one) => one.path)).toEqual([
      '/s/a.md',
    ])
    expect(told).toEqual(['gone /s/a.md'])
    expect(ws.undone.stack).toEqual([])
  })

  test('and sends what it cannot compare to the trash', async () => {
    const ws = store({ kind: 'import', paths: ['/s/paper.pdf'], wrote: {} })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'delete_note')).toEqual([])
    expect(told).toEqual(['binned /s/paper.pdf', 'gone /s/paper.pdf'])
  })
})

describe('a copy taken back', () => {
  test('sends what it made to the trash, a folder as a folder, and tells the index', async () => {
    const ws = store({
      kind: 'copy',
      made: [
        { path: '/s/a copy.md', folder: false, from: '/s/a.md' },
        { path: '/s/Trip copy', folder: true, from: '/s/Trip' },
      ],
    })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command.startsWith('delete'))).toEqual([])
    expect(told).toEqual([
      'binned /s/a copy.md',
      'gone /s/a copy.md',
      'binned folder /s/Trip copy',
      'gone /s/Trip copy',
    ])
    expect(ws.undone.next?.kind).toBe('copy')
  })

  test('and one dropped from outside cannot be made again', async () => {
    const ws = store({ kind: 'copy', made: [{ path: '/s/map.png', folder: false }] })
    await undoLastFileAction(ws)

    expect(ws.undone.ahead).toEqual([])
  })
})

describe('doing it again', () => {
  function again(action: FileAction, refuse = false) {
    const ws = store(action)
    const asked: string[] = []
    const does = {
      ...ws,
      undone: ws.undone,
      move: (from: string, into: string) => {
        asked.push(`move ${from} -> ${into}`)
        if (refuse) return Promise.reject(new Error('taken'))
        ws.undone.record({ kind: 'move', from, to: `${into}/x` })
        return Promise.resolve()
      },
      rename: (path: string, name: string) => {
        asked.push(`rename ${path} -> ${name}`)
        return Promise.resolve()
      },
      remove: (path: string) => {
        asked.push(`remove ${path}`)
        return Promise.resolve()
      },
    }
    return { ws: does as unknown as PutsBack & import('./redoing').DoesAgain, asked }
  }

  test('asks for the same operation, and it is one undo away again', async () => {
    const { ws, asked } = again({ kind: 'move', from: '/s/a.md', to: '/s/Work/a.md' })
    await undoLastFileAction(ws)
    await redoLastFileAction(ws)

    expect(asked).toEqual(['move /s/a.md -> /s/Work'])
    expect(ws.undone.last?.kind).toBe('move')
    expect(ws.undone.ahead).toEqual([])
  })

  test('deletes the note where it stepped aside to, not the one at its old name', async () => {
    disk.set('/s/old.md', 'newer words')
    const written = again({ kind: 'delete', path: '/s/old.md', content: 'kept words' })
    await undoLastFileAction(written.ws)
    await redoLastFileAction(written.ws)
    expect(written.asked).toEqual(['remove /s/old 2.md'])

    const trashed = again({ kind: 'delete', path: '/s/old.md', content: '', trashId: 't-1' })
    restores.set('t-1', '/s/old 2.md')
    await undoLastFileAction(trashed.ws)
    await redoLastFileAction(trashed.ws)
    expect(trashed.asked).toEqual(['remove /s/old 2.md'])
  })

  test('renames to the name it had been given, and deletes what it had deleted', async () => {
    const renamed = again({ kind: 'rename', from: '/s/a.md', to: '/s/Plan.md' })
    await undoLastFileAction(renamed.ws)
    await redoLastFileAction(renamed.ws)

    const deleted = again({ kind: 'delete', path: '/s/old.md', content: 'kept words' })
    await undoLastFileAction(deleted.ws)
    await redoLastFileAction(deleted.ws)

    expect(renamed.asked).toEqual(['rename /s/a.md -> Plan.md'])
    expect(deleted.asked).toEqual(['remove /s/old.md'])
    expect(deleted.ws.undone.canRedo).toBe(false)
  })

  test('keeps what is further ahead when it does the nearer one again', async () => {
    const { ws, asked } = again({ kind: 'move', from: '/s/a.md', to: '/s/Work/a.md' })
    ws.undone.record({ kind: 'move', from: '/s/b.md', to: '/s/Work/b.md' })

    await undoLastFileAction(ws)
    await undoLastFileAction(ws)
    expect(ws.undone.ahead.map((one) => one.kind === 'move' && one.from)).toEqual([
      '/s/b.md',
      '/s/a.md',
    ])

    await redoLastFileAction(ws)

    expect(asked).toEqual(['move /s/a.md -> /s/Work'])
    expect(ws.undone.next).toEqual({ kind: 'move', from: '/s/b.md', to: '/s/Work/b.md' })
  })

  test('does nothing at all when nothing was taken back', async () => {
    const { ws, asked } = again({ kind: 'move', from: '/s/a.md', to: '/s/Work/a.md' })
    await redoLastFileAction(ws)

    expect(asked).toEqual([])
    expect(ws.undone.last?.kind).toBe('move')
  })

  test('keeps what it could not do, to be asked for again', async () => {
    const { ws } = again({ kind: 'move', from: '/s/a.md', to: '/s/Work/a.md' }, true)
    await undoLastFileAction(ws)
    await redoLastFileAction(ws)

    expect(ws.undone.next?.kind).toBe('move')
  })

  test('stops at a merge, which kept only the way back', async () => {
    const ws = store({
      kind: 'merge',
      from: '/s/a.md',
      fromContent: 'a',
      into: '/s/b.md',
      intoContent: 'b',
      intoAfter: '',
    })
    await undoLastFileAction(ws)

    expect(ws.undone.ahead).toEqual([])
    expect(ws.undone.canRedo).toBe(false)
  })
})

describe('a name put back', () => {
  test('rewrites the links that followed it, and only when they were rewritten', async () => {
    const ws = store({ kind: 'rename', from: '/s/a.md', to: '/s/b.md', rewrote: true })
    await undoLastFileAction(ws)

    expect(sent).toEqual([{ command: 'rename_note', path: '', content: '' }])
    expect(told).toEqual(['retargeted /s/b.md -> /s/a.md', 'moved /s/b.md -> /s/a.md'])
  })

  test('and leaves the links alone where the rename did not touch them', async () => {
    const ws = store({ kind: 'move', from: '/s/a.md', to: '/s/f/a.md' })
    await undoLastFileAction(ws)

    expect(told).toEqual(['moved /s/f/a.md -> /s/a.md'])
  })
})

describe('a merge and a carve put back', () => {
  const MERGE = {
    kind: 'merge',
    from: '/s/a.md',
    fromContent: '# a',
    into: '/s/b.md',
    intoContent: '# b',
    intoAfter: '# b\n\n# a',
  } as const

  const SPLIT = {
    kind: 'split',
    from: '/s/a.md',
    fromContent: '# a\n\n## b\n',
    fromAfter: '# a\n\n[[b]]\n',
    created: '/s/b.md',
    createdContent: '## b\n',
  } as const

  test('a merge writes both notes and points the links back at the one that left', async () => {
    disk.set('/s/b.md', MERGE.intoAfter)
    const ws = store({ ...MERGE })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.path)).toEqual([
      '/s/b.md',
      '/s/a.md',
    ])
    expect(told).toEqual([
      'saved /s/b.md',
      'saved /s/a.md',
      'reloaded /s/b.md',
      'retargeted /s/b.md -> /s/a.md',
    ])
  })

  test('and leaves a merge alone whose note has been written in since', async () => {
    disk.set('/s/b.md', `${MERGE.intoAfter}\n\ntyped since`)
    const ws = store({ ...MERGE })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
    expect(ws.undone.last?.kind).toBe('merge')
  })

  test('and writes the folded note beside one that has arrived at its name', async () => {
    disk.set('/s/b.md', MERGE.intoAfter)
    disk.set('/s/a.md', '# a, arrived since')
    const ws = store({ ...MERGE })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'write_note').map((one) => one.path)).toEqual([
      '/s/b.md',
      '/s/a 2.md',
    ])
    expect(told).toContain('retargeted /s/b.md -> /s/a 2.md')
  })

  test('a split writes the note whole again and takes the carved one away', async () => {
    disk.set('/s/a.md', SPLIT.fromAfter)
    disk.set('/s/b.md', SPLIT.createdContent)
    const ws = store({ ...SPLIT })
    await undoLastFileAction(ws)

    expect(
      sent
        .filter((one) => one.command === 'write_note' || one.command === 'delete_note')
        .map((one) => `${one.command} ${one.path}`),
    ).toEqual(['write_note /s/a.md', 'delete_note /s/b.md'])
    expect(told).toEqual(['saved /s/a.md', 'gone /s/b.md', 'reloaded /s/a.md'])
  })

  test('and leaves a split alone whose note has been written in since', async () => {
    disk.set('/s/a.md', `${SPLIT.fromAfter}typed since\n`)
    disk.set('/s/b.md', SPLIT.createdContent)
    const ws = store({ ...SPLIT })
    await undoLastFileAction(ws)

    expect(
      sent.filter((one) => one.command === 'write_note' || one.command === 'delete_note'),
    ).toEqual([])
    expect(ws.undone.last?.kind).toBe('split')
  })

  test('and keeps a carved note that has been written in since', async () => {
    disk.set('/s/a.md', SPLIT.fromAfter)
    disk.set('/s/b.md', `${SPLIT.createdContent}typed since\n`)
    const ws = store({ ...SPLIT })
    await undoLastFileAction(ws)

    expect(sent.filter((one) => one.command === 'delete_note')).toEqual([])
    expect(told).toEqual(['saved /s/a.md', 'reloaded /s/a.md'])
  })

  test('and a carved note that will not go does not stop the note coming back', async () => {
    refused.add('delete_note /s/b.md')
    disk.set('/s/a.md', '[[b]]')
    disk.set('/s/b.md', '')
    const ws = store({
      kind: 'extract',
      from: '/s/a.md',
      fromContent: '# a',
      fromAfter: '[[b]]',
      created: '/s/b.md',
      createdContent: '',
    })
    await undoLastFileAction(ws)

    expect(ws.undone.stack).toEqual([])
    expect(told).toEqual(['saved /s/a.md', 'gone /s/b.md', 'reloaded /s/a.md'])
  })
})

describe('an archiving put back', () => {
  function archived(action: FileAction) {
    const changes: unknown[] = []
    const opened: string[] = []
    const ws = Object.assign(store(action), {
      archive: { change: (...args: unknown[]) => void changes.push(args) },
      openEntry: (path: string) => {
        opened.push(path)
        return Promise.resolve()
      },
    }) as unknown as PutsBack

    return { ws, changes, opened }
  }

  test('takes back what it put away, and opens the tabs it closed', async () => {
    const { ws, changes, opened } = archived({
      kind: 'archive',
      root: '/s',
      archived: ['Plan.md'],
      restored: [],
      closed: ['/s/Plan.md'],
    })
    await undoLastFileAction(ws)

    expect(changes).toEqual([['/s', [], ['Plan.md']]])
    expect(opened).toEqual(['/s/Plan.md'])
    expect(ws.undone.stack).toEqual([])
    expect(sent).toEqual([])
  })

  test('and puts back away what taking a note out of a folder left out', async () => {
    const { ws, changes } = archived({
      kind: 'unarchive',
      root: '/s',
      archived: ['Old/Notes.md'],
      restored: ['Old'],
      closed: [],
    })
    await undoLastFileAction(ws)

    expect(changes).toEqual([['/s', ['Old'], ['Old/Notes.md']]])
    expect(ws.undone.ahead).toHaveLength(1)
  })
})

describe('a gesture of several', () => {
  test('is recorded as one step, and one that recorded one is that one', async () => {
    const undone = new FileActions()
    await undone.batch(() => {
      undone.record({ kind: 'delete', path: '/s/a.md', content: '# a' })
      undone.record({ kind: 'delete', path: '/s/b.md', content: '# b' })
      return Promise.resolve()
    })
    await undone.batch(() => {
      undone.record({ kind: 'move', from: '/s/c.md', to: '/s/W/c.md' })
      return Promise.resolve()
    })

    expect(undone.stack.map((one) => one.kind)).toEqual(['many', 'move'])
    expect(undone.label).toBe('Undo moving c')
    undone.stack = undone.stack.slice(0, 1)
    expect(undone.label).toBe('Undo the deletion')
  })

  test('is said as its first step where it mixed kinds, and keeps a trash id', async () => {
    const undone = new FileActions()
    await undone.batch(() => {
      undone.record({ kind: 'delete', path: '/s/A/b.md', content: '# b' })
      undone.trashed('/s/A/b.md', 'id-b')
      undone.record({ kind: 'move', from: '/s/A/A.md', to: '/s/A.md', follows: true })
      return Promise.resolve()
    })

    expect(undone.label).toBe('Undo deleting b')
    const [step] = undone.stack
    expect(step?.kind === 'many' && step.steps[0]).toMatchObject({ trashId: 'id-b' })

    undone.forget('id-b')
    expect(undone.stack).toEqual([
      { kind: 'many', steps: [{ kind: 'move', from: '/s/A/A.md', to: '/s/A.md', follows: true }] },
    ])
  })

  test('goes back newest first, and is one step to do again', async () => {
    const ws = store({
      kind: 'many',
      steps: [
        { kind: 'delete', path: '/s/A/b.md', content: '# b' },
        { kind: 'move', from: '/s/A/A.md', to: '/s/A.md', follows: true },
      ],
    })
    await undoLastFileAction(ws)

    expect(sent.map((one) => `${one.command} ${one.path}`)).toEqual([
      'rename_note ',
      'file_stamp /s/A/b.md',
      'read_tree ',
      'write_note /s/A/b.md',
    ])
    expect(told).toEqual(['moved /s/A.md -> /s/A/A.md', 'back /s/A/b.md'])
    expect(ws.undone.stack).toEqual([])
    expect(ws.undone.next?.kind).toBe('many')
  })

  test('that stops half way keeps what is left on the stack', async () => {
    refused.add('/s/A/b.md')
    const ws = store({
      kind: 'many',
      steps: [
        { kind: 'delete', path: '/s/A/b.md', content: '# b' },
        { kind: 'move', from: '/s/c.md', to: '/s/W/c.md' },
      ],
    })
    await undoLastFileAction(ws)

    expect(ws.undone.stack).toEqual([
      { kind: 'many', steps: [{ kind: 'delete', path: '/s/A/b.md', content: '# b' }] },
    ])
    expect(ws.undone.ahead).toEqual([])
  })

  test('done again asks for each step but the ones the others cause', async () => {
    const ws = store({
      kind: 'many',
      steps: [
        { kind: 'delete', path: '/s/A/b.md', content: '# b' },
        { kind: 'move', from: '/s/A/A.md', to: '/s/A.md', follows: true },
        { kind: 'move', from: '/s/c.md', to: '/s/W/c.md' },
      ],
    })
    const asked: string[] = []
    const does = Object.assign(ws, {
      move: (from: string, into: string) => {
        asked.push(`move ${from} -> ${into}`)
        ws.undone.record({ kind: 'move', from, to: `${into}/c.md` })
        return Promise.resolve()
      },
      remove: (path: string, folder: boolean) => {
        asked.push(`remove ${path}${folder ? ' folder' : ''}`)
        ws.undone.record({ kind: 'delete', path, content: '' })
        return Promise.resolve()
      },
      rename: () => Promise.resolve(),
    }) as unknown as PutsBack & import('./redoing').DoesAgain

    await undoLastFileAction(does)
    await redoLastFileAction(does)

    expect(asked).toEqual(['remove /s/A/b.md', 'move /s/c.md -> /s/W'])
    expect(does.undone.stack.map((one) => one.kind)).toEqual(['many'])
    expect(does.undone.ahead).toEqual([])
  })
})

describe('something made, taken back', () => {
  test('goes to Recently deleted, and comes back out of it when done again', async () => {
    const ws = store({ kind: 'create', path: '/s/New.md' })
    const does = Object.assign(ws, {
      move: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }) as unknown as PutsBack & import('./redoing').DoesAgain

    await undoLastFileAction(does)
    expect(told).toEqual(['binned /s/New.md', 'gone /s/New.md'])
    expect(does.undone.next).toEqual({
      kind: 'create',
      path: '/s/New.md',
      content: '# new',
      trashId: 't-/s/New.md',
    })

    told.length = 0
    await redoLastFileAction(does)
    expect(sent.at(-1)).toMatchObject({ command: 'restore_trash' })
    expect(told).toEqual(['back /s/New.md'])
    expect(does.undone.last).toEqual({ kind: 'create', path: '/s/New.md' })
  })

  test('and a folder a nesting made goes with the note that went into it', async () => {
    const ws = store({ kind: 'move', from: '/s/A.md', to: '/s/A/A.md', nests: true })
    await undoLastFileAction(ws)

    expect(sent.map((one) => `${one.command} ${one.path}`)).toEqual([
      'rename_note ',
      'remove_empty_folder /s/A',
    ])
  })
})

describe('a folder deleted', () => {
  test('signed in comes back as the folders and the words it held', async () => {
    const ws = store({
      kind: 'delete',
      path: '/s/A',
      content: '',
      folder: true,
      notes: [{ path: '/s/A/B/b.md', content: '# b' }],
      folders: ['/s/A/B'],
    })
    await undoLastFileAction(ws)

    expect(sent.map((one) => `${one.command} ${one.path}`)).toEqual([
      'create_folder /s/A',
      'create_folder /s/A/B',
      'file_stamp /s/A/B/b.md',
      'read_tree ',
      'write_note /s/A/B/b.md',
    ])
    expect(told.at(-1)).toBe('back /s/A')
  })

  test('signed out comes back out of the trash whole', async () => {
    const ws = store({ kind: 'delete', path: '/s/A', content: '', folder: true, trashId: 'f1' })
    await undoLastFileAction(ws)

    expect(sent).toEqual([{ command: 'restore_trash', path: '', content: '' }])
    expect(told.at(-1)).toBe('back /s/A')
  })
})

describe('what the account holds of a folder', () => {
  const at = (path: string, children: unknown[] = [], more: object = {}) => ({
    name: path.split('/').pop(),
    path,
    is_dir: children.length > 0 || 'unlisted' in more,
    modified: 0,
    created: 0,
    children,
    ...more,
  })
  const holdsAll = () => Promise.resolve(true)

  beforeEach(() => trees.clear())

  test('one whose every file is held is held', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/Inner', [at('/s/Work/Inner/a.md')])]))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(true)
  })

  test('one holding a picture is not, however well the account holds it', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/a.md'), at('/s/Work/cat.png')]))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(false)
  })

  test('nor one holding a paper deeper down', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/Inner', [at('/s/Work/Inner/paper.pdf')])]))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(false)
  })

  test('clutter sync leaves alone does not count against it', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/a.md'), at('/s/Work/Thumbs.db')]))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(true)
  })

  test('one holding a folder the listing did not read into is not', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/linked', [], { unlisted: true })]))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(false)
  })

  test('nor one the listing could not read into itself', async () => {
    trees.set('/s/Work', at('/s/Work', [], { unlisted: true }))

    expect(await accountHoldsAll('/s/Work', holdsAll)).toBe(false)
  })

  test('asks after each file with when it was written and one allowance for all', async () => {
    trees.set('/s/Work', at('/s/Work', [at('/s/Work/a.md'), at('/s/Work/b.md')]))
    const asked: { path: string; modified?: number; budget?: object }[] = []

    await accountHoldsAll('/s/Work', (path, how) => {
      asked.push({ path, ...how })
      return Promise.resolve(true)
    })

    expect(asked.map((one) => [one.path, one.modified])).toEqual([
      ['/s/Work/a.md', 0],
      ['/s/Work/b.md', 0],
    ])
    expect(asked[0]?.budget).toBe(asked[1]?.budget)
  })
})

describe('a replacement put back with another window here', () => {
  const NOTE = {
    content: 'alpha line\n',
    after: 'gamma line\n',
    edits: [{ from: 0, to: 5, insert: 'alpha' }],
  }

  test("a closed note is read again in the file's turn", async () => {
    disk.set('/s/a.md', NOTE.after)
    const turns: (() => unknown)[] = []
    let inTurn = false
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, ...rest: unknown[]) => {
          const run = rest.at(-1) as (lock: unknown) => unknown
          if (!name.startsWith('nib:file:')) return run({ name })
          await new Promise((go) => turns.push(() => go(undefined)))
          inTurn = true
          try {
            return await run({ name })
          } finally {
            inTurn = false
          }
        },
      },
    })
    try {
      const ws = store({ kind: 'replace', notes: [{ path: '/s/a.md', ...NOTE }] })
      const undoing = undoLastFileAction(ws)
      await vi.waitFor(() => expect(turns.length).toBe(1))
      expect(inTurn).toBe(false)
      disk.set('/s/a.md', 'gamma line\nWORDS-IN-B\n')
      turns[0]?.()
      await undoing
    } finally {
      vi.unstubAllGlobals()
    }
    expect(sent.filter((one) => one.command === 'write_note').at(-1)?.content).toBe(
      'alpha line\nWORDS-IN-B\n',
    )
  })
})
