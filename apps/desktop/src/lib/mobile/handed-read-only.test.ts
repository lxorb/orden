import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  readOnly: ['/theirs'] as string[],
  spaces: [] as { id: string; name: string; root: string }[],
  answer: 'new',
  asked: [] as { options: { id: string }[] }[],
  shared: 'a link',
  done: 0,
  open: false,
  typed: [] as string[],
  tasks: [] as { root?: string; typed?: boolean }[],
}))

vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) => !world.readOnly.some((root) => path.startsWith(root)),
}))

const imported: { target: { root: string } }[] = []
vi.mock('../import/apply', () => ({
  applyImport: (_plan: unknown, target: { root: string }) => {
    imported.push({ target })
    return Promise.resolve({ paths: [], stepped: 0 })
  },
}))

vi.mock('../platform/src/mobile-bridge', () => ({
  onTheActivity: () => true,
  frameWord: () => Promise.resolve('word'),
  method: (name: string) =>
    ({
      handed: () => '',
      shared: () =>
        JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: world.shared }] }),
      sharedDone: () => {
        world.done++
      },
    })[name],
  answer: () => undefined,
}))
vi.mock('./widgets.svelte', () => ({ watchWidgets: () => () => undefined }))
vi.mock('../commands', () => ({ appCommands: () => [] }))
vi.mock('../views.svelte', () => ({
  views: { of: () => (world.open ? { state: { readOnly: false } } : null) },
}))
vi.mock('../insert-picture', () => ({
  putPicture: () => undefined,
  writeAtCaret: (_view: unknown, words: string) => void world.typed.push(words),
}))
vi.mock('../ui-kit/src/prompt.svelte', () => ({
  prompt: {
    choose: (question: { options: { id: string }[] }) => {
      world.asked.push(question)
      return Promise.resolve(world.answer)
    },
  },
}))
vi.mock('../task-actions', () => ({
  addTask: (_text: string, options: { root?: string; typed?: boolean } = {}) => {
    world.tasks.push(options)
    return Promise.resolve({ path: `${options.root}/Inbox.md`, line: 0 })
  },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return world.spaces
    },
    activeSpace: { id: 'theirs', name: 'Theirs', root: '/theirs' },
    get active() {
      return world.open ? { kind: 'note', shown: 'Open' } : null
    },
    panes: { focusedId: 'a' },
    open: () => Promise.resolve(),
    openEntry: () => Promise.resolve(),
  },
}))

const { startHanded } = await import('./handed')

async function share() {
  const stop = startHanded()
  await new Promise((done) => setTimeout(done, 20))
  stop()
}

const THEIRS = { id: 'theirs', name: 'Theirs', root: '/theirs' }
const MINE = { id: 'mine', name: 'Mine', root: '/mine' }

beforeEach(() => {
  imported.length = 0
  world.readOnly = ['/theirs']
  world.spaces = [THEIRS, MINE]
  world.answer = 'new'
  world.asked = []
  world.shared = 'a link'
  world.done = 0
  world.open = false
  world.typed = []
  world.tasks = []
})

describe('a share while the open space is shared to be read', () => {
  test('makes its note in the first space that may be written in', async () => {
    await share()
    await vi.waitFor(() => expect(imported).toHaveLength(1))
    expect(imported[0]?.target.root).toBe('/mine')
    expect(world.done).toBe(1)
  })

  test("makes its task in the reader's one inbox, naming no space (#1157)", async () => {
    world.answer = 'task'
    await share()
    await vi.waitFor(() => expect(world.tasks).toEqual([{ typed: false }]))
  })

  test("in the reader's own space, stays there", async () => {
    world.readOnly = []
    await share()
    await vi.waitFor(() => expect(imported).toHaveLength(1))
    expect(imported[0]?.target.root).toBe('/theirs')
  })
})

describe('a share with no space that may be written in', () => {
  test('makes nothing and is kept, not let go of', async () => {
    world.spaces = [THEIRS]
    await share()
    expect(imported).toEqual([])
    expect(world.tasks).toEqual([])
    expect(world.asked).toEqual([])
    expect(world.done).toBe(0)
  })

  test('is offered only for the note open to write in', async () => {
    world.spaces = [THEIRS]
    world.open = true
    world.answer = 'here'
    await share()
    expect(world.asked.map((one) => one.options.map((option) => option.id))).toEqual([['here']])
    expect(world.typed).toEqual(['a link'])
    expect(world.done).toBe(1)
  })
})

describe('words shared into the open note', () => {
  test('open no markup there', async () => {
    world.readOnly = []
    world.open = true
    world.answer = 'here'
    world.shared = 'see <img src=x onerror=alert(1)>'
    await share()
    expect(world.typed).toEqual(['see \\<img src=x onerror=alert(1)>'])
  })
})
