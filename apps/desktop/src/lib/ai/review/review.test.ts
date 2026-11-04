import { EditorState, type TransactionSpec } from '@orden/editor'
import { reviewMarks, reviewMarksOf } from '@orden/editor/review'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Thread, Turn } from '../chat/types'

/** The review over real notes: a stand-in desk with documents really open in it
 *  (lib/agents/docs/test-desk.ts), the agent's real steps, and the workspace and the
 *  sends standing in for the app around them. */

const fake = vi.hoisted(() => ({
  desk: null as unknown as ReturnType<typeof import('../../agents/docs/test-desk').deskWith>,
  documents: [] as NoteDoc[],
  removed: [] as string[],
  opened: [] as string[],
  /** Files that are there and will not read: another encoding, or a lock. */
  unreadable: new Set<string>(),
  /** The moves made back: the space's folder, from, to. */
  moves: [] as string[][],
  /** The tree's Undo, as far as a delete goes. */
  undone: { stack: [] as { kind: string; path: string; content: string }[] },
  /** Writes that fail, by path. */
  unwritable: new Set<string>(),
}))

vi.mock('../../automation/acts', () => ({
  movedIn: async (root: string, from: string, to: string) => {
    fake.moves.push([root, from, to])
    // The disk's name changes where the desk has the note, and what follows a move hears.
    const [was, now] = [`${root}/${from}`, `${root}/${to}`]
    const words = fake.desk.disk.get(was)
    if (words === undefined) return
    // A move onto a name that is taken is refused, as the verb refuses it.
    if (fake.desk.disk.has(now)) throw new Error(`${to} is taken`)
    fake.desk.disk.delete(was)
    fake.desk.disk.set(now, words)
    const { tracksMoved } = await import('../../agents/docs/edit')
    tracksMoved(was, now)
  },
}))

// A note put back beside whatever is at its name now, as the trash puts one back.
vi.mock('../../workspace/undoing', () => ({
  putBack: (step: { path: string; content: string }) => {
    const path = fake.desk.disk.has(step.path) ? step.path.replace('.md', ' 2.md') : step.path
    fake.desk.disk.set(path, step.content)
    return Promise.resolve(path)
  },
}))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    get documents() {
      return fake.documents
    },
    spaces: [
      { id: 's1', name: 'Space', root: '/space' },
      { id: 's2', name: 'Other', root: '/other' },
      // On Linux a space can differ from another only by case.
      { id: 's3', name: 'space', root: '/space2' },
    ],
    noteText: (path: string) =>
      fake.unreadable.has(path) ? Promise.resolve(null) : fake.desk.desk.noteText(path),
    remove: (path: string) => {
      fake.removed.push(path)
      fake.undone.stack.push({ kind: 'delete', path, content: fake.desk.disk.get(path) ?? '' })
      fake.desk.disk.delete(path)
      return Promise.resolve()
    },
    get undone() {
      return fake.undone
    },
    fileCame: () => Promise.resolve(),
    open: (path: string) => {
      fake.opened.push(path)
      return Promise.resolve()
    },
    activeSpace: { id: 's1', name: 'Space', root: '/space' },
    active: null,
    loadTree: () => Promise.resolve(),
    goto: null,
  },
}))

vi.mock('../../agents/docs', async () => {
  const edit = await import('../../agents/docs/edit')
  const { located } = await import('../../agents/docs/desk')
  const at = (path: string) =>
    located(fake.desk.desk, { path: path.slice('/space/'.length), space: 's1' })
  return {
    onTracks: edit.onTracks,
    trackedAgents: edit.trackedAgents,
    tracksOf: edit.tracksOf,
    tracksAside: edit.tracksAside,
    undoSomeIn: (
      agent: { id: string; name: string },
      path: string,
      ids: ReadonlySet<string>,
      token?: string,
    ) => edit.undoSomeAt(fake.desk.desk, agent, at(path), ids, token),
    putBackIn: (agent: { id: string; name: string }, path: string, token: string) =>
      edit.putBackAt(fake.desk.desk, agent, at(path), token),
  }
})

vi.mock('../../on-disk', () => ({
  onDisk: (path: string) => Promise.resolve(fake.desk.disk.has(path)),
}))

vi.mock('../chat/sends', () => ({
  answeringAt: (provider: string) => (provider.startsWith('p') ? `t-${provider}` : null),
  onSend: () => () => undefined,
  onSent: () => () => undefined,
}))

// An agent's caret, and the mark on the tabs showing the note: no tabs here.
vi.mock('../../agents/docs/presence', () => ({ showAgent: () => undefined }))

vi.mock('./summary', () => ({ summarized: () => Promise.resolve('summary') }))

vi.mock('../../workspace/write-file', () => ({
  writeFile: (path: string, words: string) => {
    if (fake.unwritable.has(path)) return Promise.reject(new Error('the disk is full'))
    fake.desk.disk.set(path, words)
    return Promise.resolve()
  },
}))

const { deskWith } = await import('../../agents/docs/test-desk')
const { editNote } = await import('../../agents/docs/edit')
const { review } = await import('./review.svelte')
const { busy } = await import('../../busy.svelte')

/** A view of a note with the review's marks in it. */
class Viewer {
  state: EditorState
  constructor(note: NoteDoc) {
    this.state = EditorState.create({ doc: note.live.text, extensions: [reviewMarks()] })
    note.live.join(this)
  }
  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
  }
}

let made = 0
let clock = 1_000

/** A provider of its own for every test: what an agent did is kept for the session. */
function aThread(): Thread & { provider: string } {
  made++
  const provider = `p${String(made)}`
  return {
    id: `t-${provider}`,
    space: 's1',
    title: '',
    provider,
    model: 'm',
    effort: 'auto',
    mode: 'full',
    turns: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, window: null },
    created: 0,
    updated: 0,
  }
}

/** The reader sends a message, which the agent answers by editing. */
async function message(
  thread: Thread,
  words: string,
  edits: { path: string; at: unknown; replace: string }[],
  parts: Turn['parts'] = [],
  by: string = thread.id,
) {
  clock += 1000
  const turn: Turn = {
    id: words,
    role: 'you',
    at: clock,
    parts: [],
    draft: { text: words, attachments: [] },
  }
  thread.turns.push(turn)
  clock += 10
  for (const one of edits) {
    await editNote(
      fake.desk.desk,
      { id: `nib-${thread.provider}`, name: 'nib', thread: by },
      { path: one.path },
      [{ at: one.at, replace: one.replace }],
    )
  }
  thread.turns.push({
    id: `${words}-answer`,
    role: 'model',
    at: clock,
    parts,
    provider: thread.provider,
  })
}

const settle = (ms = 0) => new Promise((done) => setTimeout(done, ms))

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a rewind', () => {
  test('across three notes takes back what came after, and Redo puts it back', async () => {
    fake.desk = deskWith({ 'a.md': 'one', 'b.md': 'two', 'c.md': 'three' }, [
      'a.md',
      'b.md',
      'c.md',
    ])
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    const panel = { send: vi.fn(), text: '', touched: vi.fn(), release: vi.fn() }

    await message(thread, 'first', [{ path: 'a.md', at: { quote: 'one' }, replace: 'ONE' }])
    await message(thread, 'second', [
      { path: 'a.md', at: { start: true }, replace: '' },
      { path: 'b.md', at: { quote: 'two' }, replace: 'TWO' },
      { path: 'c.md', at: { quote: 'three' }, replace: 'THREE' },
    ])
    fake.desk.panes['b.md']?.type(0, '> ')
    expect(review.notes(thread).map((one) => one.path)).toEqual([
      '/space/a.md',
      '/space/b.md',
      '/space/c.md',
    ])

    await review.rewind(thread, 'second', 'both', panel)
    expect(fake.desk.panes['a.md']?.text).toBe('ONE')
    expect(fake.desk.panes['b.md']?.text).toBe('> two')
    expect(fake.desk.panes['c.md']?.text).toBe('three')
    expect(thread.turns.map((one) => one.id)).toEqual(['first', 'first-answer'])
    expect(panel.text).toBe('second')
    expect(panel.touched).toHaveBeenCalledWith(thread)
    // A change in the field is let go before the rewound words take it.
    expect(panel.release).toHaveBeenCalledTimes(1)

    await review.putBack(thread, panel)
    expect(panel.release).toHaveBeenCalledTimes(2)
    expect(fake.desk.panes['b.md']?.text).toBe('> TWO')
    expect(fake.desk.panes['c.md']?.text).toBe('THREE')
    expect(thread.turns).toHaveLength(4)
  })

  test('a second rewind leaves alone the note the reader made at the name', async () => {
    fake.desk = deskWith({ 'Made.md': 'new words' })
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      [
        {
          kind: 'tool',
          id: 'c-again',
          verb: 'create_note',
          args: { path: 'Made' },
          state: 'ok',
          result: { text: '{"path":"Made.md","created":true}', images: [], error: false },
        },
      ],
    )
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual(['/space/Made.md'])

    fake.removed = []
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual([])
  })

  test('Redo brings back the compaction the turns it brings back held up', async () => {
    fake.desk = deskWith({ 'A.md': 'a' })
    fake.documents = []
    const thread = aThread()
    await message(thread, 'first', [], [])
    await message(thread, 'second', [], [])
    const compaction = { upTo: 'second', kind: 'summary', model: 'm', summary: 'short' } as const
    thread.compaction = compaction
    await review.rewind(thread, 'second', 'conversation', null)
    expect(thread.compaction).toBeUndefined()
    await review.putBack(thread, null)
    expect(thread.compaction).toEqual(compaction)
  })

  test('sends a note the thread made since to Recently deleted', async () => {
    fake.desk = deskWith({ 'Made.md': 'new words' })
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      [
        {
          kind: 'tool',
          id: 'c1',
          verb: 'create_note',
          args: { path: 'Made' },
          state: 'ok',
          result: { text: '{"path":"Made.md","created":true}', images: [], error: false },
        },
      ],
    )

    expect(review.plan(thread, 'make')?.choices).toContain('notes')
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual(['/space/Made.md'])

    await review.putBack(thread, null)
    expect(fake.desk.fileOf('Made.md')).toBe('new words')
  })

  /** Something can arrive at the name between the rewind and the redo, and a file
   *  there that will not read is not a gap to fill: writing the thread's words into it
   *  wrote over whatever it holds. */
  test('and puts it back only where nothing is at its name', async () => {
    fake.desk = deskWith({ 'Made.md': 'new words' })
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      [
        {
          kind: 'tool',
          id: 'c1',
          verb: 'create_note',
          args: { path: 'Made' },
          state: 'ok',
          result: { text: '{"path":"Made.md","created":true}', images: [], error: false },
        },
      ],
    )
    await review.rewind(thread, 'make', 'notes', null)

    fake.desk.disk.set('/space/Made.md', 'latin-1 bytes')
    fake.unreadable.add('/space/Made.md')
    try {
      await review.putBack(thread, null)
    } finally {
      fake.unreadable.clear()
    }
    expect(fake.desk.fileOf('Made.md')).toBe('latin-1 bytes')
  })

  /** A folder is not a note: rewinding past `create_folder` named the reader's own
   *  note of the same name, `Projects.md`, and sent it to Recently deleted. */
  test('leaves alone a note named like a folder the thread made', async () => {
    fake.desk = deskWith({ 'Projects.md': 'my own words' })
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      [
        {
          kind: 'tool',
          id: 'c1',
          verb: 'mcp__nib__create_folder',
          args: { path: 'Projects' },
          state: 'ok',
          result: { text: '{"path":"Projects","made":false}', images: [], error: false },
        },
      ],
    )

    expect(review.plan(thread, 'make')?.made).toEqual([])
    await review.rewind(thread, 'make', 'both', null)
    expect(fake.removed).toEqual([])
    expect(fake.desk.fileOf('Projects.md')).toBe('my own words')
  })
})

/** A thread stays open across a switch of space, and a call that names none runs in
 *  the space in front: taking it back in the thread's own space deleted or moved the
 *  reader's note of that name there, on every device. */
describe('a rewind over a thread that did things in any order', () => {
  const FILES = { 'A.md': 'original' }
  const panel = () => ({ send: vi.fn(), text: '', touched: vi.fn(), release: vi.fn() })
  const row = (id: string, verb: string, args: object, answer: object): Turn['parts'][number] => {
    clock += 10
    return {
      kind: 'tool',
      id,
      verb,
      args,
      state: 'ok',
      at: clock,
      result: { text: JSON.stringify(answer), images: [], error: false },
    }
  }
  /** What a thread's calls do, each the way its verb does it, in the order given. */
  const acts = {
    edit: async (thread: Thread & { provider: string }, path: string, from: string, to: string) => {
      clock += 10
      await editNote(
        fake.desk.desk,
        { id: `nib-${thread.provider}`, name: 'nib', thread: thread.id },
        { path },
        [{ at: { quote: from }, replace: to }],
      )
      clock += 10
      return [] as Turn['parts']
    },
    move: async (from: string, to: string) => {
      const { movedIn } = await import('../../automation/acts')
      await movedIn('/space', from, to)
      fake.moves = []
      return [row(`m${String(clock)}`, 'move_file', { path: from, to }, { from, to })]
    },
    trash: (path: string) => {
      fake.desk.disk.delete(`/space/${path}`)
      fake.undone.stack.push({
        kind: 'delete',
        path: `/space/${path}`,
        content: fake.desk.written.at(-1)?.changes[0]?.after ?? 'original',
      })
      return [row(`t${String(clock)}`, 'trash_file', { path }, { trashed: true, path })]
    },
    make: (path: string, words: string) => {
      fake.desk.disk.set(`/space/${path}`, words)
      return [row(`c${String(clock)}`, 'create_note', { path }, { path, created: true })]
    },
  }
  /** The reader's message, and then the calls that answered it, each taking its turn. */
  const running = async (
    thread: Thread,
    steps: (() => Promise<Turn['parts']> | Turn['parts'])[],
  ) => {
    clock += 1000
    thread.turns.push({
      id: 'go',
      role: 'you',
      at: clock,
      parts: [],
      draft: { text: 'go', attachments: [] },
    })
    const parts: Turn['parts'] = []
    for (const step of steps) parts.push(...(await step()))
    thread.turns.push({
      id: 'go-answer',
      role: 'model',
      at: clock,
      parts,
      provider: thread.provider,
    })
  }
  const files = () =>
    Object.fromEntries([...fake.desk.disk].map(([path, words]) => [path.slice(7), words]))

  beforeEach(() => {
    fake.desk = deskWith(FILES)
    fake.documents = []
    fake.removed = []
    fake.undone.stack = []
    fake.unwritable.clear()
    busy.clear()
  })

  test('moved aside and a new note made at the name: back as it was, and Redo again', async () => {
    const thread = aThread()
    await running(thread, [() => acts.move('A.md', 'B.md'), () => acts.make('A.md', 'new')])

    await review.rewind(thread, 'go', 'notes', null)
    expect(files()).toEqual({ 'A.md': 'original' })
    expect(busy.trouble).toBeNull()

    await review.putBack(thread, null)
    expect(files()).toEqual({ 'A.md': 'new', 'B.md': 'original' })
  })

  test('deleted and a new note made at the name: back as it was, and Redo again', async () => {
    const thread = aThread()
    await running(thread, [() => acts.trash('A.md'), () => acts.make('A.md', 'new')])

    await review.rewind(thread, 'go', 'notes', null)
    expect(files()).toEqual({ 'A.md': 'original' })
    expect(busy.trouble).toBeNull()

    await review.putBack(thread, null)
    expect(files()).toEqual({ 'A.md': 'new' })
  })

  test('edited and then deleted: back with the words it had before', async () => {
    const thread = aThread()
    await running(thread, [
      () => acts.edit(thread, 'A.md', 'original', 'EDITED'),
      () => acts.trash('A.md'),
    ])
    expect(files()).toEqual({})

    await review.rewind(thread, 'go', 'notes', null)
    expect(files()).toEqual({ 'A.md': 'original' })
    expect(busy.trouble).toBeNull()
  })

  test('edited, moved and edited again: back whole, and Redo does all three', async () => {
    fake.desk = deskWith({ 'A.md': 'one two' })
    const thread = aThread()
    await running(thread, [
      () => acts.edit(thread, 'A.md', 'one', 'ONE'),
      () => acts.move('A.md', 'B.md'),
      () => acts.edit(thread, 'B.md', 'two', 'TWO'),
    ])

    await review.rewind(thread, 'go', 'notes', null)
    expect(files()).toEqual({ 'A.md': 'one two' })
    expect(busy.trouble).toBeNull()

    await review.putBack(thread, null)
    expect(files()).toEqual({ 'B.md': 'ONE TWO' })
  })

  test('edited and then moved: conversation cut too', async () => {
    fake.desk = deskWith({ 'Heron.md': 'A heron strikes' })
    const thread = aThread()
    const asked = panel()
    await running(thread, [
      () => acts.edit(thread, 'Heron.md', 'strikes', 'STRIKES'),
      () => acts.move('Heron.md', 'Bird.md'),
    ])

    await review.rewind(thread, 'go', 'both', asked)
    expect(files()).toEqual({ 'Heron.md': 'A heron strikes' })
    expect(thread.turns).toEqual([])
    expect(asked.text).toBe('go')
    expect(review.sheet).toBeNull()

    await review.putBack(thread, asked)
    expect(files()).toEqual({ 'Bird.md': 'A heron STRIKES' })
    expect(thread.turns).toHaveLength(2)
  })

  test('made and then moved goes to Recently deleted, and Redo brings it back moved', async () => {
    fake.desk = deskWith({})
    const thread = aThread()
    await running(thread, [() => acts.make('A.md', 'new'), () => acts.move('A.md', 'B.md')])

    await review.rewind(thread, 'go', 'notes', null)
    expect(fake.removed).toEqual(['/space/A.md'])
    expect(files()).toEqual({})

    await review.putBack(thread, null)
    expect(files()).toEqual({ 'B.md': 'new' })
  })

  test('a note that has gone: the rest goes back, the conversation is cut, and it says so', async () => {
    fake.desk = deskWith({ 'a.md': 'one', 'b.md': 'two' })
    const thread = aThread()
    const asked = panel()
    await running(thread, [
      () => acts.edit(thread, 'a.md', 'one', 'ONE'),
      () => acts.edit(thread, 'b.md', 'two', 'TWO'),
    ])
    fake.desk.disk.delete('/space/a.md')

    await review.rewind(thread, 'go', 'both', asked)
    expect(fake.desk.fileOf('b.md')).toBe('two')
    expect(thread.turns).toEqual([])
    expect(asked.text).toBe('go')
    expect(busy.trouble).toBeTruthy()
  })

  test('a move back that is refused says so', async () => {
    const thread = aThread()
    await running(thread, [() => acts.move('A.md', 'B.md')])
    fake.desk.disk.set('/space/A.md', 'the reader’s own')

    await review.rewind(thread, 'go', 'notes', null)
    expect(files()).toEqual({ 'A.md': 'the reader’s own', 'B.md': 'original' })
    expect(busy.trouble).toBeTruthy()
  })

  test('a Redo that fails part way keeps what is left of it to try again', async () => {
    const thread = aThread()
    const asked = panel()
    await running(thread, [() => acts.move('A.md', 'B.md'), () => acts.make('A.md', 'new')])
    await review.rewind(thread, 'go', 'both', asked)

    fake.unwritable.add('/space/A.md')
    await review.putBack(thread, asked)
    expect(busy.trouble).toBeTruthy()
    expect(review.canRedo(thread)).toBe(true)
    expect(thread.turns).toEqual([])

    fake.unwritable.clear()
    await review.putBack(thread, asked)
    expect(files()).toEqual({ 'A.md': 'new', 'B.md': 'original' })
    expect(thread.turns).toHaveLength(2)
    expect(review.canRedo(thread)).toBe(false)
  })
})

describe('a call made in the space in front, not the thread’s', () => {
  let calls = 0
  const tool = (verb: string, args: unknown, answer: string): Turn['parts'] => [
    {
      kind: 'tool',
      id: `c-${verb}-${String(++calls)}`,
      verb,
      args,
      state: 'ok',
      result: { text: answer, images: [], error: false },
    },
  ]

  test('a rewind sends the note it made there to Recently deleted, not the reader’s', async () => {
    fake.desk = deskWith({ 'Made.md': 'the reader’s own words' })
    fake.desk.disk.set('/other/Made.md', 'the agent’s words')
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      tool('create_note', { path: 'Made' }, '{"path":"Made.md","created":true,"space":"s2"}'),
    )
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual(['/other/Made.md'])
    expect(fake.desk.fileOf('Made.md')).toBe('the reader’s own words')
  })

  test('Undo moves a note back where it was moved', async () => {
    fake.desk = deskWith({ 'B.md': 'x' })
    fake.documents = []
    fake.moves = []
    const thread = aThread()
    await message(
      thread,
      'move',
      [],
      tool('move_file', { path: 'A.md', to: 'B.md' }, '{"from":"A.md","to":"B.md","space":"s2"}'),
    )
    await review.undoFiles(thread, review.files(thread))
    expect(fake.moves).toEqual([['/other', 'B.md', 'A.md']])
  })

  test('a space only the case of a name tells from another is still the one it ran in', async () => {
    fake.desk = deskWith({ 'Made.md': 'the reader’s own words' })
    fake.desk.disk.set('/space2/Made.md', 'the agent’s words')
    fake.documents = []
    fake.removed = []
    const thread = { ...aThread(), space: 's3' }
    // By id, as the verbs answer now, and by its exact name, as a call that named it did.
    await message(
      thread,
      'by id',
      [],
      tool('create_note', { path: 'Made' }, '{"path":"Made.md","created":true,"space":"s3"}'),
    )
    await review.rewind(thread, 'by id', 'notes', null)
    expect(fake.removed).toEqual(['/space2/Made.md'])

    fake.desk.disk.set('/space2/Made.md', 'the agent’s words')
    fake.removed = []
    await message(
      thread,
      'by name',
      [],
      tool('create_note', { path: 'Made', space: 'space' }, '{"path":"Made.md","created":true}'),
    )
    await review.rewind(thread, 'by name', 'notes', null)
    expect(fake.removed).toEqual(['/space2/Made.md'])
    expect(fake.desk.fileOf('Made.md')).toBe('the reader’s own words')
  })

  test('a space named in another case is that space', async () => {
    fake.desk = deskWith({})
    fake.desk.disk.set('/other/Made.md', 'the agent’s words')
    fake.documents = []
    fake.removed = []
    const thread = aThread()
    await message(
      thread,
      'make',
      [],
      tool('create_note', { path: 'Made', space: 'other' }, '{"path":"Made.md","created":true}'),
    )
    await review.rewind(thread, 'make', 'notes', null)
    expect(fake.removed).toEqual(['/other/Made.md'])
  })
})

/** Every thread of a provider writes as one agent: while two run at once, an edit put
 *  down to whichever started last went with that thread's rewind. */
describe('two threads of one provider at once', () => {
  test('each has only the edits its own calls made', async () => {
    fake.desk = deskWith({ 'a.md': 'one', 'b.md': 'two' }, ['a.md', 'b.md'])
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    await message(thread, 'mine', [{ path: 'a.md', at: { quote: 'one' }, replace: 'ONE' }])
    await message(
      thread,
      'while',
      [{ path: 'b.md', at: { quote: 'two' }, replace: 'TWO' }],
      [],
      'another-thread',
    )
    expect(review.notes(thread).map((one) => one.path)).toEqual(['/space/a.md'])

    await review.rewind(thread, 'mine', 'both', null)
    expect(fake.desk.panes['a.md']?.text).toBe('one')
    expect(fake.desk.panes['b.md']?.text).toBe('TWO')
  })
})

describe('a change', () => {
  test('kept leaves the list, and its mark fades out of the note', async () => {
    fake.desk = deskWith({ 'k.md': 'one two' }, ['k.md'])
    const note = fake.desk.panes['k.md']?.note
    if (!note) throw new Error('open')
    fake.documents = [note]
    const viewer = new Viewer(note)
    const thread = aThread()

    await message(thread, 'go', [{ path: 'k.md', at: { quote: 'two' }, replace: 'TWO' }])
    await settle()
    expect(reviewMarksOf(viewer.state)).toEqual([
      { id: expect.any(String) as string, from: 4, to: 7, removed: 'two' },
    ])

    // On a clock of the test's own: the fade's timer hands its last drawing to another,
    // and a machine that held both back past a real wait of 250 ms ran the wait first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      review.keep(review.changes(thread))
      expect(review.changes(thread)).toEqual([])
      await vi.advanceTimersByTimeAsync(250)
      expect(reviewMarksOf(viewer.state)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('undone goes, with a later edit that rewrote its words', async () => {
    fake.desk = deskWith({ 'u.md': 'alpha omega' }, ['u.md'])
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    await message(thread, 'one', [{ path: 'u.md', at: { quote: 'alpha' }, replace: 'beta gamma' }])
    await message(thread, 'two', [
      { path: 'u.md', at: { quote: 'gamma' }, replace: 'delta' },
      { path: 'u.md', at: { quote: 'omega' }, replace: 'OMEGA' },
    ])

    const [first] = review.changes(thread)
    if (!first) throw new Error('changed')
    expect(await review.undo([first])).toBe(1)
    expect(fake.desk.panes['u.md']?.text).toBe('alpha OMEGA')
    expect(review.said).toBe('and 1 after it')
    expect(review.changes(thread)).toHaveLength(1)
  })
})

describe('a helper on another provider', () => {
  /** `run_agent` routes a helper to any provider in use: its edits are its parent's. */
  test('is in the review of the thread that started it', async () => {
    fake.desk = deskWith({ 'x.md': 'one two' })
    fake.documents = Object.values(fake.desk.panes).map((pane) => pane.note)
    const thread = aThread()
    const helper = aThread()
    ;(thread as Thread & { helpers?: string[] }).helpers = [helper.id]
    await message(thread, 'ask', [])
    await message(helper, 'go', [{ path: 'x.md', at: { quote: 'two' }, replace: 'TWO' }])

    expect(review.changes(thread).map((one) => one.agent)).toEqual([`nib-${helper.provider}`])
  })
})

describe('Follow', () => {
  test('brings a note the thread edits to the front, only while it is on', async () => {
    fake.desk = deskWith({ 'f.md': 'one', 'g.md': 'two' })
    fake.documents = []
    fake.opened = []
    const thread = aThread()

    await message(thread, 'quiet', [{ path: 'f.md', at: { quote: 'one' }, replace: 'ONE' }])
    expect(fake.opened).toEqual([])

    review.toggleFollow(thread)
    await message(thread, 'loud', [{ path: 'g.md', at: { quote: 'two' }, replace: 'TWO' }])
    expect(fake.opened).toEqual(['/space/g.md'])
    review.toggleFollow(thread)
  })

  /** A step taken back is heard like one made: only an edit landing brings its note up. */
  test('does not bring a note up when one of its edits is taken back', async () => {
    fake.desk = deskWith({ 'h.md': 'one two' })
    fake.documents = []
    const thread = aThread()
    review.toggleFollow(thread)
    await message(thread, 'edit', [
      { path: 'h.md', at: { quote: 'one' }, replace: 'ONE' },
      { path: 'h.md', at: { quote: 'two' }, replace: 'TWO' },
    ])
    fake.opened = []
    const [first] = review.changes(thread)
    if (!first) throw new Error('changed')
    await review.undo([first])
    expect(fake.opened).toEqual([])
    review.toggleFollow(thread)
  })
})
