import { answer, readBase, type Row } from '@nib/bases'
import { render } from 'svelte/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A view over a space shared with this account to be read (B280). Today, Upcoming and
 *  a base across every space draw that space's rows beside the reader's own, and its
 *  base files and repeating templates are read here like any other. Nothing a view
 *  does may write there: the copy here would stop being the space's, and the sync
 *  refuses it on every pass. So a tick, a cell, a drop, an add and a change of the view
 *  write nothing and say so, and the runner makes no note and runs no automation. */

const disk = new Map<string, string>()
/** Every whole file written, by path, and every folder made. */
const written: string[] = []
const folders: string[] = []

/** The roots of the spaces shared with this account to be read. */
const readOnly = new Set<string>()
const insideOf = (root: string, path: string) => path === root || path.startsWith(`${root}/`)

vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) => ![...readOnly].some((root) => insideOf(root, path)),
}))

/** Every address a press opened. */
const opened: string[] = []

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  openExternal: (address: string) => {
    opened.push(address)
    return Promise.resolve()
  },
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'read_note' || command === 'read_tree') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such file')) : Promise.resolve(held)
    }
    if (command === 'create_folder') folders.push(path)
    return Promise.resolve('')
  },
}))

vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, content: string) => {
    written.push(path)
    disk.set(path, content)
    return Promise.resolve()
  },
}))

// As the real one: a note in a space shared to be read is passed over, and the answer
// is how many were written (workspace/note-text.ts).
vi.mock('../workspace/note-text', () => ({
  noteText: (_ws: unknown, path: string) => Promise.resolve(disk.get(path) ?? null),
  writeNoteText: () => Promise.resolve(),
  replaceInNotes: (
    _ws: unknown,
    changes: { path: string; after: string }[],
    keeping: { together?: boolean } = {},
  ) => {
    const refused = (path: string) => [...readOnly].some((root) => insideOf(root, path))
    if (keeping.together && changes.some((one) => refused(one.path))) return Promise.resolve(0)
    let done = 0
    for (const one of changes) {
      if ([...readOnly].some((root) => insideOf(root, one.path))) continue
      written.push(one.path)
      disk.set(one.path, one.after)
      done++
    }
    return Promise.resolve(done)
  },
}))

const THEIRS = { id: 'theirs', name: 'Theirs', root: '/theirs' }
const MINE = { id: 'mine', name: 'Mine', root: '/mine' }

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [THEIRS, MINE],
    activeSpace: THEIRS,
    notes: [],
    freeName: (_dir: string, name: string) => name,
    freeNameOnDisk: (_dir: string, name: string) => Promise.resolve(name),
    loadTree: () => Promise.resolve(),
    fileCame: () => Promise.resolve(),
    open: () => Promise.resolve(),
    move: (from: string) => {
      written.push(`moved ${from}`)
      return Promise.resolve()
    },
    documentAt: () => null,
    noteText: (path: string) => Promise.resolve(disk.get(path) ?? null),
    undone: { last: null, stack: [] },
  },
}))

/** The rows every shown space holds, the read one's among them. */
let shown: Row[] = []

vi.mock('../rows/rows.svelte', () => ({
  rows: {
    ready: true,
    of: (space?: string) => shown.filter((row) => space === undefined || row.space === space),
    at: () => [],
    watch: () => () => undefined,
    inbox: () => Promise.resolve(null),
    write: async (row: Row, change: import('../rows/write').RowChange) => {
      const { writeRow } = await import('../rows/write')
      const root = row.space === 'Theirs' ? THEIRS.root : MINE.root
      return writeRow({} as never, `${root}/${row.path}`, row, change)
    },
  },
}))

vi.mock('../rooms.svelte', () => ({ rooms: { present: {}, following: null } }))
vi.mock('../surfaces.svelte', () => ({ showQuickAdd: () => undefined }))
vi.mock('./open', () => ({ openBaseFile: () => undefined }))
vi.mock('../reminders/platform', () => ({ show: () => undefined }))

/** What the automations of a base would do once a note settles: write its rows and
 *  move its note, both into the space the base is in. */
const planning = vi.hoisted((): { plan: unknown } => ({
  plan: { writes: [], moves: [], notices: [] },
}))
vi.mock('./automate', () => ({ planned: () => planning.plan }))

const { noteRow, taskRow } = await import('./fixture')
const { kitFor } = await import('./kit')
const { moveRowsTo, tickRow, writeEach } = await import('./act')
const { offersPlaces, placeEntries } = await import('./project-actions')
const { addNote } = await import('./add')
const { heard, readHeld, repeatTemplates } = await import('./running')
const { contextFor } = await import('./context')
const { columnsOf } = await import('./columns')
const Cell = (await import('./Cell.svelte')).default
const BoardLayout = (await import('./BoardLayout.svelte')).default
const TaskSheet = (await import('./task-view/TaskSheet.svelte')).default

const PLAN = 'Plan.md'
const TASK = '- [ ] water the plants'

/** A view over every space, as Today is, of a view of notes grouped by status. */
function viewOver(file: string | null) {
  const base = readBase('views:\n  - type: table\n    name: All\n')
  const changes: unknown[] = []
  const live = {
    base,
    at: 0,
    today: '2026-10-24',
    context: contextFor({ rows: [], today: '2026-10-24', now: '2026-10-24T12:00' }),
    view: { type: 'table', groupBy: { property: 'note.status' }, nib: { rows: 'notes' } },
    writtenAt: file,
    locked: false,
    refused: 0,
    change: (next: unknown) => {
      changes.push(next)
      return Promise.resolve()
    },
  }
  const kit = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, file, false)
  return { kit, live, changes }
}

beforeEach(() => {
  disk.clear()
  written.length = 0
  folders.length = 0
  opened.length = 0
  readOnly.clear()
  readOnly.add(THEIRS.root)
  disk.set(`${THEIRS.root}/${PLAN}`, `---\nstatus: open\n---\n${TASK}\n`)
  disk.set(`${MINE.root}/${PLAN}`, `---\nstatus: open\n---\n${TASK}\n`)
  shown = []
  planning.plan = { writes: [], moves: [], notices: [] }
})

const theirTask = () => taskRow(PLAN, TASK, 3, { space: 'Theirs' })
const theirNote = () => noteRow(PLAN, { status: 'open' }, {}, 'Theirs')

describe('a view over a space shared to be read', () => {
  test('offers no write of its rows, and still offers the reader their own', () => {
    const { kit } = viewOver(null)
    expect(kit.writes(theirTask())).toBe(false)
    expect(kit.writes(taskRow(PLAN, TASK, 3, { space: 'Mine' }))).toBe(true)
  })

  test('ticks no task, and answers that it did not', async () => {
    const { kit } = viewOver(null)
    expect(await kit.tick(theirTask())).toBe(false)
    expect(written).toEqual([])
  })

  test('and a tick that was turned away is not one done', async () => {
    expect(await tickRow(theirTask(), '2026-10-24')).toBe(false)
    expect(await tickRow(taskRow(PLAN, TASK, 3, { space: 'Mine' }), '2026-10-24')).toBe(true)
    expect(written).toEqual([`${MINE.root}/${PLAN}`])
  })

  test('writes no cell and drops no card', async () => {
    const { kit } = viewOver(null)
    kit.write(theirNote(), { note: { status: 'done' } })
    kit.drop(theirNote(), 'done')
    await new Promise((done) => setTimeout(done, 10))
    expect(written).toEqual([])
    expect(disk.get(`${THEIRS.root}/${PLAN}`)).toContain('status: open')
  })

  test('adds no note to the view of a base in it', async () => {
    const { kit } = viewOver(`${THEIRS.root}/Bugs.base`)
    expect(kit.writable).toBe(false)
    expect(kit.add()).toBeNull()
    await new Promise((done) => setTimeout(done, 10))
    expect(written).toEqual([])
    expect(await addNote(readBase('views:\n  - type: table\n'), 0, null)).toBeNull()
    expect(written).toEqual([])
  })

  test('changes no base file of it', async () => {
    const { kit, changes } = viewOver(`${THEIRS.root}/Bugs.base`)
    kit.change((base) => base)
    expect(await kit.changed((base) => base)).toBe(false)
    expect(changes).toEqual([])
  })

  test("while a view of the reader's own base still changes", async () => {
    const { kit, changes } = viewOver(`${MINE.root}/Bugs.base`)
    expect(kit.writable).toBe(true)
    expect(await kit.changed((base) => base)).toBe(true)
    expect(changes).toHaveLength(1)
  })

  test('writes no row of many as one', async () => {
    expect(await writeEach([{ row: theirNote(), change: { note: { status: 'done' } } }])).toBe(
      false,
    )
    expect(written).toEqual([])
  })
})

/** A board of a base file, grouped by status, over this space's notes, drawn as
 *  LiveView would hold it. */
function boardOver(file: string) {
  const base = readBase(`views:
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
`)
  const rows = [theirNote()]
  const context = contextFor({ rows, today: '2026-10-24', now: '2026-10-24T12:00' })
  const live = {
    base,
    at: 0,
    view: base.views[0],
    rows,
    context,
    today: '2026-10-24',
    answer: answer(base, 0, rows, context),
    columns: columnsOf(base, 0, rows),
    writtenAt: file,
    locked: false,
    refused: 0,
    colourOf: () => null,
    change: () => Promise.resolve(),
  }
  const kit = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, file, false)
  return render(BoardLayout, { props: { kit } }).body
}

describe('a board of a base in a space shared to be read', () => {
  test('offers no new page, in a column or at its head', () => {
    const html = boardOver(`${THEIRS.root}/Bugs.base`)
    expect(html).toContain('open')
    expect(html).not.toContain('data-new-page')
    expect(html).not.toContain('aria-label="New page"')
  })

  test("while a board of the reader's own still does", () => {
    const html = boardOver(`${MINE.root}/Bugs.base`)
    expect(html).toContain('data-new-page')
    expect(html).toContain('aria-label="New page"')
  })
})

/** A base whose button sets a row's status and opens an address. */
const SHIP = readBase(`nib:
  buttons:
    Ship:
      set: { status: done }
      open: https://example.com
views:
  - type: table
    order: [file.name, button.Ship]
`)

describe('a button of a row in a space shared to be read', () => {
  test('is not pressable', () => {
    const { kit } = viewOver(null)
    const props = { row: theirNote(), property: 'button.Ship', editor: 'button', kit }
    const html = render(Cell, { props: props as never }).body
    expect(html).toMatch(/<button[^>]*class="nib-chip press[^>]*disabled/)
  })

  test('and a press of it does nothing', async () => {
    const { kit, live } = viewOver(null)
    ;(live as { base: unknown }).base = SHIP
    kit.press(theirNote(), 'button.Ship')
    await new Promise((done) => setTimeout(done, 10))
    expect(written).toEqual([])
    expect(opened).toEqual([])
  })

  test("while the reader's own still presses", async () => {
    const { kit, live } = viewOver(null)
    ;(live as { base: unknown }).base = SHIP
    kit.press(noteRow(PLAN, { status: 'open' }, {}, 'Mine'), 'button.Ship')
    await vi.waitFor(() => expect(opened).toEqual(['https://example.com']))
    const html = render(Cell, {
      props: {
        row: noteRow(PLAN, { status: 'open' }, {}, 'Mine'),
        property: 'button.Ship',
        editor: 'button',
        kit,
      } as never,
    }).body
    expect(html).not.toMatch(/<button[^>]*class="nib-chip press[^>]*disabled/)
  })
})

/** A cell of a row, being edited as a table edits the one the keyboard is on. */
function cellOf(row: Row, property: string, editor: string) {
  const { kit } = viewOver(null)
  const props = { row, property, editor, kit, editing: true }
  return render(Cell, { props: props as never }).body
}

describe('the cells of a row in a space shared to be read', () => {
  test('take no words and tick no box', () => {
    const theirs = cellOf(theirTask(), 'task.text', 'text')
    expect(theirs).not.toMatch(/class="edit[ "]/)
    expect(theirs).toMatch(/<button[^>]*class="box[^>]*disabled/)
  })

  test("while the reader's own still do", () => {
    const mine = cellOf(taskRow(PLAN, TASK, 3, { space: 'Mine' }), 'task.text', 'text')
    expect(mine).toMatch(/class="edit[ "]/)
    expect(mine).not.toMatch(/<button[^>]*class="box[^>]*disabled/)
  })
})

describe('the runner, in a space shared to be read', () => {
  test('makes no note of a repeating template', async () => {
    const template = noteRow('Templates/Daily.md', { repeat: 'every day' }, {}, 'Theirs')
    disk.set(`${THEIRS.root}/Templates/Daily.md`, '---\nrepeat: every day\n---\nToday\n')
    shown = [template]

    await repeatTemplates()
    expect(written).toEqual([])
    expect(folders).toEqual([])
  })

  /** A base's automations, run once a note of the space settles. Each test settles a
   *  note of its own, since the runner hears its own write of one as its own. */
  async function settle(name: string) {
    const row = noteRow(name, { status: 'open' }, {}, 'Theirs')
    disk.set(`${THEIRS.root}/${name}`, '---\nstatus: open\n---\n')
    vi.useFakeTimers()
    try {
      const base = `${THEIRS.root}/Bugs.base`
      disk.set(base, 'nib:\n  id:\n    property: id\nviews:\n  - type: table\n')
      await readHeld(base)
      planning.plan = {
        writes: [{ row, change: { note: { status: 'done' } } }],
        moves: [{ row, folder: 'Done' }],
        notices: [],
      }

      heard('Theirs', name, [])
      await vi.advanceTimersByTimeAsync(200)
    } finally {
      vi.useRealTimers()
    }
    // The run's own writes, which are awaited one after the other past the timer.
    await new Promise((done) => setTimeout(done, 20))
  }

  test("runs none of a base's automations", async () => {
    await settle('Bug 1.md')
    expect(written).toEqual([])
    expect(folders).toEqual([])
  })

  test("which run where the space is the reader's own", async () => {
    readOnly.clear()
    await settle('Bug 2.md')
    await vi.waitFor(() => expect(folders).toEqual([`${THEIRS.root}/Done`]))
    expect(written).toContain(`${THEIRS.root}/Bug 2.md`)
  })
})

/** A task's own view, of a task of the space shared to be read and of the reader's. */
function sheetOf(space: 'Theirs' | 'Mine') {
  const row = taskRow(PLAN, TASK, 3, { space })
  shown = [row]
  const { kit } = viewOver(null)
  const ref = { space, path: PLAN, line: 3, hash: row.anchor?.hash ?? '' }
  return render(TaskSheet, { props: { shown: { ref, list: [ref], kit } } }).body
}

describe("a task's view, in a space shared to be read", () => {
  test('takes no words, no comment and no sub-task', () => {
    const html = sheetOf('Theirs')
    expect(html).toContain('water the plants')
    expect(html).toMatch(/<input[^>]*class="title[^>]*readonly/)
    expect(html).not.toContain('aria-label="Comment"')
    expect(html).not.toContain('Add sub-task')
    expect(html).not.toContain('add-tag')
  })

  test("while the reader's own still does", () => {
    const html = sheetOf('Mine')
    expect(html).not.toMatch(/<input[^>]*class="title[^>]*readonly/)
    expect(html).toContain('aria-label="Comment"')
    expect(html).toContain('Add sub-task')
    expect(html).toContain('add-tag')
  })
})

/** A move between spaces writes two notes, the cut and the arrival, and is only a move
 *  where both land (B287). */
describe('a move with one end in a space shared to be read', () => {
  const mine = () => taskRow(PLAN, TASK, 3, { space: 'Mine' })

  test('does not take a task of mine into their note, and keeps it in mine', async () => {
    expect(await moveRowsTo([mine()], `${THEIRS.root}/${PLAN}`)).toBe(false)
    expect(written).toEqual([])
    expect(disk.get(`${MINE.root}/${PLAN}`)).toContain(TASK)
  })

  test('does not copy one of theirs into mine', async () => {
    disk.set(`${MINE.root}/Inbox.md`, '')
    expect(await moveRowsTo([theirTask()], `${MINE.root}/Inbox.md`)).toBe(false)
    expect(written).toEqual([])
    expect(disk.get(`${MINE.root}/Inbox.md`)).toBe('')
  })

  test('offers no place in a space shared to be read', () => {
    expect(offersPlaces()).toBe(false)
    expect(placeEntries(() => undefined)).toEqual([])
  })
})

/** The Tasks panel, over a space shared to be read: it makes no project and saves no
 *  filter there, since each is a file written into the space (B292). */
describe('the Tasks panel, in a space shared to be read', () => {
  const reading = { lang: 'en', today: '2026-10-24' } as never

  test('makes no project, at the top, inside another or beside one', async () => {
    const { addProject, addProjectBeside, addSubproject } = await import('./project-actions')
    const parent = { note: `${THEIRS.root}/Projects/Garden.md`, folder: null }
    expect(await addProject(THEIRS.root, 'Secret')).toBeNull()
    expect(await addSubproject(parent, 'Beds')).toBeNull()
    expect(await addProjectBeside(parent, 'Shed', true)).toBeNull()
    expect(written).toEqual([])
  })

  test("while one is still made in the reader's own", async () => {
    const { addProject } = await import('./project-actions')
    expect(await addProject(MINE.root, 'Mine')).not.toBeNull()
    expect(written).toHaveLength(1)
  })

  test('saves no filter, new or over the one it was read from', async () => {
    const { saveFilter } = await import('./filters')
    expect(await saveFilter('Soon', 'today', reading, null)).toBeNull()
    expect(await saveFilter('Soon', 'today', reading, `${THEIRS.root}/Filters/Soon.base`)).toBe(
      null,
    )
    expect(written).toEqual([])
  })
})

/** A task typed into Today, Upcoming or the panel lands in the open space's inbox, made
 *  the first time; in a space shared to be read there is nowhere for it (B293). */
describe('an add whose task would land in a space shared to be read', () => {
  test('makes no inbox there', async () => {
    const { inboxNote } = await import('../rows/inbox-note')
    expect(await inboxNote(THEIRS.root)).toBeNull()
    expect(written).toEqual([])
  })

  test('is not offered in a view over every space', async () => {
    const workspace = (await import('../workspace.svelte')).workspace as { activeSpace: unknown }
    const { kit } = viewOver(null)
    expect(kit.adds).toBe(false)
    const AddRow = (await import('./AddRow.svelte')).default
    expect(render(AddRow, { props: { kit } }).body).not.toContain('Add task')

    workspace.activeSpace = MINE
    try {
      expect(kit.adds).toBe(true)
    } finally {
      workspace.activeSpace = THEIRS
    }
  })
})

/** Copy to a base writes the view as a file at the root of the open space (B294). */
describe('copy to a base, in a space shared to be read', () => {
  test('writes no base, and is not offered', async () => {
    const { copiesToBase, copyToBase } = await import('./save')
    expect(copiesToBase()).toBe(false)
    expect(await copyToBase('views: []\n', 'Today')).toBeNull()
    expect(written).toEqual([])
  })
})
