import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Recording where nothing may be written.
 *
 *  A recording is two writes: the sound, stored beside the note, and the embed, put
 *  into the note. In a space somebody shared with this account to be read the sync
 *  refuses the first on every pass, and the editor refuses the second, so the file
 *  would be left on the disk with nothing naming it. A note of the reader's own in
 *  Read-only mode refuses the embed the same way. So Record is not offered there, and
 *  a recording that is asked for anyway writes nothing. */

const readOnly = vi.hoisted(() => new Set<string>())
const stored = vi.hoisted(() => [] as string[])
const editor = vi.hoisted(() => ({ readOnly: false }))

vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

vi.mock('./container', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./container')>()),
  canRecordHere: () => true,
}))

vi.mock('../assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assets')>()),
  storeBeside: (_bytes: ArrayBuffer, note: string, name: string) => {
    stored.push(`${note} ${name}`)
    return Promise.resolve(`${note.slice(0, note.lastIndexOf('/'))}/${name}`)
  },
}))

vi.mock('../views.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../views.svelte')>()),
  views: { of: () => ({ state: { readOnly: editor.readOnly } }) },
}))

vi.mock('./microphone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./microphone')>()),
  record: () =>
    Promise.resolve({
      stop: () => Promise.resolve({ bytes: new ArrayBuffer(4), seconds: 1 }),
      extension: 'weba',
    }),
}))

const { workspace } = await import('../workspace.svelte')
const { canRecord } = await import('./commands')
const { noteToRecordInto } = await import('./note')
const { recorder } = await import('./recording.svelte')

const THEIRS = '/theirs'
const MINE = '/mine'

type View = Parameters<typeof canRecord>[0]
const view = (locked: boolean) => ({ state: { readOnly: locked } }) as unknown as View

/** The space in front, and the note in front of it, or none. */
function inFront(root: string, note: string | null) {
  vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({ id: root, name: root, root })
  vi.spyOn(workspace, 'active', 'get').mockReturnValue(
    (note ? { kind: 'note', path: note } : null) as typeof workspace.active,
  )
  workspace.tabs = note
    ? ([{ note: { path: note }, paneId: 'p' }] as unknown as typeof workspace.tabs)
    : []
}

beforeEach(() => {
  readOnly.clear()
  readOnly.add(THEIRS)
  stored.length = 0
  editor.readOnly = false
})

afterEach(() => {
  vi.restoreAllMocks()
  workspace.tabs = []
})

describe('Record', () => {
  test('is offered over a note of the reader’s own', () => {
    inFront(MINE, `${MINE}/a.md`)
    expect(canRecord(view(false))).toBe(true)
  })

  test('is not offered over a note in a space shared to be read', () => {
    inFront(THEIRS, `${THEIRS}/a.md`)
    expect(canRecord(view(true))).toBe(false)
    expect(canRecord()).toBe(false)
  })

  test('is not offered over a note in Read-only mode', () => {
    inFront(MINE, `${MINE}/a.md`)
    expect(canRecord(view(true))).toBe(false)
  })

  test('is not offered with no note in front of a space shared to be read', () => {
    inFront(THEIRS, null)
    expect(canRecord()).toBe(false)
  })
})

describe('the note a recording goes into', () => {
  test('is none in a space shared to be read, and none is made there', async () => {
    const create = vi.spyOn(workspace, 'createNote').mockResolvedValue(undefined)
    inFront(THEIRS, null)

    expect(await noteToRecordInto()).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  test('is not a note there either', async () => {
    inFront(THEIRS, `${THEIRS}/a.md`)
    expect(await noteToRecordInto()).toBeNull()
  })

  test('is not a note in Read-only mode', async () => {
    inFront(MINE, `${MINE}/a.md`)
    editor.readOnly = true
    expect(await noteToRecordInto()).toBeNull()
  })
})

/** A tab of a `.txt` or a `.json` is a note tab too, and an embed written into one is
 *  a line of Markdown in a file that is not. So a recording over one goes into a new
 *  note, as one over no note at all does. */
describe('over a file that is not Markdown', () => {
  test('a recording goes into a new note rather than into the file', async () => {
    inFront(MINE, `${MINE}/data.json`)
    const create = vi.spyOn(workspace, 'createNote').mockImplementation(() => {
      inFront(MINE, `${MINE}/Recording.md`)
      return Promise.resolve(undefined)
    })

    expect(await noteToRecordInto()).toBe(`${MINE}/Recording.md`)
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('keeping a recording', () => {
  /** A recording started over a note that could be written, and stopped once it no
   *  longer can: the space shared to be read meanwhile, or Read-only turned on. */
  async function recordThen(change: () => void) {
    inFront(MINE, `${MINE}/a.md`)
    await recorder.start()
    change()
    await recorder.stop()
  }

  test('writes nothing into a space shared to be read', async () => {
    await recordThen(() => readOnly.add(MINE))
    expect(stored).toEqual([])
  })

  test('writes nothing beside a note in Read-only mode', async () => {
    await recordThen(() => (editor.readOnly = true))
    expect(stored).toEqual([])
  })

  test('is written beside a note that may be written', async () => {
    await recordThen(() => undefined)
    expect(stored).toHaveLength(1)
  })
})
