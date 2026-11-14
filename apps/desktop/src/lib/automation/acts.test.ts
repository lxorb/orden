import { describe, expect, test, vi } from 'vitest'
import { frontMatterValue } from '@orden/markdown/front-matter'

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

const space = { id: 'work', name: 'Work', root: '/Work' }

let named: string | null = null
let beside: string | null = null

let scanning: Promise<void> = Promise.resolve()
let scans = 0

const opened: string[] = []

const held = new Map<string, string>()

const written: { path: string; before: string; after: string }[] = []
const made: { folder: string; name: string }[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    fileNamed: () => beside,
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target.includes('/') ? null : named,
    scanned: () => {
      scans += 1
      return scanning
    },
    outgoing: () => [],
    backlinks: () => [],
  },
}))

const moves = vi.hoisted(() => ({
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [space],
    rename: moves.rename,
    moveMany: moves.moveMany,
    activeSpace: space,
    activeSpaceId: space.id,
    active: null,
    files: [],
    panes: { focusedId: null },
    tabs: [{ path: '/Work/notes/Plan.md' }],
    flush: () => undefined,
    showSpace: () => Promise.resolve(),
    openEntry: (path: string) => {
      opened.push(path)
      return Promise.resolve()
    },
    activeTabId: null,
    noteText: (path: string) => Promise.resolve(held.get(path) ?? null),
    replaceInNotes: (changes: { path: string; before: string; after: string }[]) => {
      for (const change of changes) {
        written.push({ path: change.path, before: change.before, after: change.after })
        held.set(change.path, change.after)
      }
      return Promise.resolve()
    },
    createNote: (folder: string, name: string) => {
      made.push({ folder, name })
      return Promise.resolve()
    },
    replace: () => undefined,
    writeNow: () => Promise.resolve(),
    open: (path: string) => {
      opened.push(path)
      return Promise.resolve()
    },
    close: () => undefined,
    activate: () => undefined,
  },
}))

const rows = [
  { id: 'files', label: 'File list', run: () => ran.push('files') },
  { id: 'record', label: 'Record', byHand: true, run: () => ran.push('record') },
  { id: 'shut', label: 'Shut', disabled: true, run: () => ran.push('shut') },
  { id: 'new-terminal', label: 'New terminal', ownWindow: true, run: () => ran.push('shell') },
]
const ran: string[] = []

vi.mock('../commands', () => ({ appCommands: () => rows }))
vi.mock('../views.svelte', () => ({ views: { of: () => undefined } }))
vi.mock('../sync.svelte', () => ({ sync: { mergeable: () => undefined } }))

const readOnly = new Set<string>()
vi.mock('../sharing/src/api', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const {
  appendNote,
  deleteFile,
  moveFile,
  movedIn,
  newNote,
  openNote,
  runCommand,
  setProperty,
  writeFile,
} = await import('./acts')

describe('a note named rather than pathed', () => {
  test('is opened at the path the index holds it under', async () => {
    named = 'notes/Plan.md'

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  test('and an index answer no space would take is refused like any other path', async () => {
    named = '../../outside.md'
    opened.length = 0

    await expect(openNote({ path: 'outside' })).rejects.toThrow(/not a path inside the space/)
    expect(opened).toEqual([])
  })

  test('asks the notes rather than the files beside them', async () => {
    named = 'notes/Plan.md'
    beside = null
    opened.length = 0

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  test('waits for the scan the launch started before asking it anything', async () => {
    named = null
    opened.length = 0
    scans = 0
    scanning = new Promise((landed) => {
      setTimeout(() => {
        named = 'notes/Plan.md'
        landed()
      }, 20)
    })

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(scans).toBe(1)
    expect(opened).toEqual(['/Work/notes/Plan.md'])

    scanning = Promise.resolve()
  })

  test('and a path is taken as written, whatever the index would say about it', async () => {
    named = 'notes/Somewhere else.md'
    opened.length = 0

    expect(await openNote({ path: 'notes/Plan.md' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })
})

describe('a row of the palette', () => {
  test('runs for the command line and for a link alike', () => {
    ran.length = 0

    expect(runCommand({ id: 'files' }, 'link')).toEqual({ id: 'files', label: 'File list' })
    expect(runCommand({ id: 'files' }, 'here')).toEqual({ id: 'files', label: 'File list' })
    expect(ran).toEqual(['files', 'files'])
  })

  test('unless it is one only somebody at the keyboard may press', () => {
    ran.length = 0

    expect(() => runCommand({ id: 'record' }, 'link')).toThrow(/not something a link may run/)
    expect(ran).toEqual([])

    expect(runCommand({ id: 'record' }, 'here')).toEqual({ id: 'record', label: 'Record' })
    expect(ran).toEqual(['record'])
  })

  test('and never one that opens a shell, on either road', () => {
    ran.length = 0

    expect(() => runCommand({ id: 'new-terminal' }, 'here')).toThrow(
      /not something the command line may run/,
    )
    expect(() => runCommand({ id: 'new-terminal' }, 'link')).toThrow(/not something/)
    expect(ran).toEqual([])
  })

  test('and a row that cannot run just now says so rather than doing nothing', () => {
    ran.length = 0

    expect(() => runCommand({ id: 'shut' }, 'here')).toThrow(/cannot run just now/)
    expect(() => runCommand({ id: 'nothing' }, 'here')).toThrow(/there is no command/)
    expect(() => runCommand({}, 'here')).toThrow(/say which command/)
    expect(ran).toEqual([])
  })
})

describe('words appended to a note', () => {
  test('go onto the end of the one that is there, once', async () => {
    held.set('/Work/Daily.md', '# Monday\n\nA kestrel.')
    written.length = 0
    made.length = 0

    expect(await appendNote({ path: 'Daily.md', content: 'And a buzzard.' })).toEqual({
      path: 'Daily.md',
      added: true,
    })

    expect(made).toEqual([])
    expect(written).toHaveLength(1)
    expect(written[0]?.after).toBe('# Monday\n\nA kestrel.\n\nAnd a buzzard.\n')
    expect(written[0]?.before).toBe('# Monday\n\nA kestrel.')
  })

  test('make the note when it is not there, rather than refusing', async () => {
    held.clear()
    written.length = 0
    made.length = 0

    expect(await appendNote({ path: 'notes/Fresh.md', content: 'A line.' })).toEqual({
      path: 'notes/Fresh.md',
      added: false,
    })

    expect(made).toEqual([{ folder: '/Work/notes', name: 'Fresh.md' }])
    expect(written).toEqual([])
  })

  test('never reach a path the space would not take', async () => {
    held.clear()
    written.length = 0
    made.length = 0

    await expect(appendNote({ path: '../../outside.md', content: 'x' })).rejects.toThrow(
      /not a path inside the space/,
    )
    expect(written).toEqual([])
    expect(made).toEqual([])
  })

  test('and the top of the note is not what append means', async () => {
    held.set('/Work/Daily.md', 'Already here.')
    written.length = 0

    await appendNote({ path: 'Daily.md', content: 'Added.', prepend: true })
    expect(written[0]?.after).toBe('Already here.\n\nAdded.\n')
  })
})

describe('a property an automation sets', () => {
  test('lands as the words it was given, whatever YAML would read them as bare', async () => {
    const values = ['Meeting: notes', '#tag', '- item', 'yes', '@home', '012', 'a #b', '1e3']

    for (const value of values) {
      held.set('/Work/Plan.md', '---\ntitle: Plan\n---\n# Plan\n')
      written.length = 0

      await setProperty({ path: 'Plan.md', key: 'status', value })
      const after = written[0]?.after ?? ''
      expect(after, value).toMatch(/^---\ntitle: Plan\nstatus: '.*'\n---\n# Plan\n$/)
      expect(frontMatterValue(after, 'status'), value).toBe(value)
    }
  })

  test('is one line however many the value had', async () => {
    held.set('/Work/Plan.md', '# Plan\n')
    written.length = 0

    await setProperty({ path: 'Plan.md', key: 'status', value: 'one\n---\ntwo' })
    expect(written[0]?.after).toBe('---\nstatus: one --- two\n---\n# Plan\n')
  })

  test('that the note already says is no change, quoted or not', async () => {
    held.set('/Work/Plan.md', "---\nstatus: 'yes'\n---\n# Plan\n")
    written.length = 0

    expect(await setProperty({ path: 'Plan.md', key: 'status', value: 'yes' })).toMatchObject({
      changed: false,
    })
    expect(written).toEqual([])
  })

  test('that is a checkbox, a number or a list keeps that type', async () => {
    const typed: [string, string][] = [
      ['true', 'status: true'],
      ['False', 'status: false'],
      ['3', 'status: 3'],
      ['-1.5', 'status: -1.5'],
      ['[work, home]', 'status: [work, home]'],
      ['[1, true, x]', 'status: [1, true, x]'],
      ['[-2.5, false, 10]', 'status: [-2.5, false, 10]'],
      [`['1', "true", x]`, "status: ['1', 'true', x]"],
      ['[007, 1e3, null, True]', "status: ['007', '1e3', 'null', 'True']"],
      ['[]', 'status: []'],
      ["['a, b', yes]", "status: ['a, b', 'yes']"],
      ['[[Project X]]', "status: '[[Project X]]'"],
      ['[[A]], [[B]]', "status: ['[[A]]', '[[B]]']"],
      ['[[[A]], [[B]]]', "status: ['[[A]]', '[[B]]']"],
    ]

    for (const [value, line] of typed) {
      held.set('/Work/Plan.md', '# Plan\n')
      written.length = 0

      await setProperty({ path: 'Plan.md', key: 'status', value })
      expect(written[0]?.after, value).toBe(`---\n${line}\n---\n# Plan\n`)
    }
  })

  test('over the same words in quotes is a change of type, not no change', async () => {
    for (const [line, value, after] of [
      ['done: "true"', 'true', 'done: true'],
      ["count: '3'", '3', 'count: 3'],
    ] as const) {
      held.set('/Work/Plan.md', `---\n${line}\n---\n# Plan\n`)
      written.length = 0

      const key = line.slice(0, line.indexOf(':'))
      expect(await setProperty({ path: 'Plan.md', key, value }), line).toMatchObject({
        changed: true,
      })
      expect(written[0]?.after, line).toBe(`---\n${after}\n---\n# Plan\n`)
    }
  })

  test('that YAML reads as itself stays bare', async () => {
    held.set('/Work/Plan.md', '# Plan\n')
    written.length = 0

    await setProperty({ path: 'Plan.md', key: 'status', value: 'In progress' })
    expect(written[0]?.after).toBe('---\nstatus: In progress\n---\n# Plan\n')
  })
})

describe('properties.set over a file that is not Markdown', () => {
  test('is refused, and writes nothing', async () => {
    held.clear()
    written.length = 0
    for (const name of ['Board.canvas', 'Pages.pages', 'Base.base', 'Talk.chat', 'Link.url']) {
      held.set(`/Work/${name}`, '{}')
      await expect(setProperty({ path: name, key: 'status', value: 'done' })).rejects.toThrow(
        /not a markdown note/,
      )
    }
    expect(written).toEqual([])
  })
})

describe('a space shared to be read', () => {
  test('takes no write from a verb, and says why', async () => {
    held.clear()
    held.set('/Work/Plan.md', '# Plan')
    written.length = 0
    made.length = 0
    readOnly.add('/Work')

    const asked = [
      () => setProperty({ path: 'Plan.md', key: 'status', value: 'done' }),
      () => appendNote({ path: 'Daily.md', content: 'A line.' }),
      () => newNote({ path: 'Fresh.md' }),
      () => writeFile({ path: 'Plan.md', content: 'Gone.' }),
      () => moveFile({ path: 'Plan.md', to: 'Later.md' }),
      () => deleteFile({ path: 'Plan.md' }),
    ]
    for (const one of asked) await expect(one()).rejects.toThrow(/shared with you to read/)

    expect(written).toEqual([])
    expect(made).toEqual([])
    readOnly.clear()
  })
})

describe('the space’s instructions, which a move does not make', () => {
  test('refused with what to do instead, whatever note it was', async () => {
    held.clear()
    held.set('/Work/Plan.md', '# Plan')
    moves.rename.mockClear()
    moves.moveMany.mockClear()
    await expect(moveFile({ path: 'Plan.md', to: 'AGENTS.md' })).rejects.toThrow('write_note')
    await expect(movedIn('/Work', 'Notes/AGENTS.md', 'AGENTS.md')).rejects.toThrow('instructions')
    expect(moves.rename).not.toHaveBeenCalled()
    expect(moves.moveMany).not.toHaveBeenCalled()
  })

  test('an Undo of a move off them puts them back', async () => {
    await movedIn('/Work', 'Old.md', 'AGENTS.md', true)
    expect(moves.rename).toHaveBeenCalledWith('/Work/Old.md', 'AGENTS.md')
  })

  test('and they may move off, or into a folder under the name', async () => {
    await expect(movedIn('/Work', 'AGENTS.md', 'Old.md')).resolves.toBe('Old.md')
    await expect(movedIn('/Work', 'Notes/AGENTS.md', 'Other/AGENTS.md')).resolves.toBe(
      'Other/AGENTS.md',
    )
  })
})
