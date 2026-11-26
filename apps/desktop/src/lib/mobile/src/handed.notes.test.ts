import { providePort } from '@orden/contracts'
import { expect, test, vi } from 'vitest'
import { readShared } from '../../import/src/api'

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
  handed: '',
  ticked: 0,
}))
vi.mock('../../sharing/src/api', () => ({
  canWriteAt: (path: string) => !world.readOnly.some((root) => path.startsWith(root)),
}))
const imported: { target: { root: string } }[] = []
providePort('import.bring', {
  here: () => Promise.resolve(new Set()),
  browser: () => Promise.resolve([]),
  notes: () => Promise.resolve({ picked: false, trouble: null }),
  shared: (json) => Promise.resolve(readShared(json)),
  landShared: (_shared, _bytes, root) => {
    imported.push({ target: { root } })
    return Promise.resolve(null)
  },
})
const said = vi.hoisted(() => {
  let speak: (word: string) => void = () => undefined
  const spoken = new Promise<string>((done) => (speak = done))
  return { word: '', spoken, speak: (word: string) => speak(word), asked: [] as string[] }
})
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  onTheActivity: () => true,
  frameWord: () => Promise.resolve(said.word),
  wordSaid: () => said.spoken,
  method: (name: string) =>
    ({
      handed: () => world.handed,
      shared: (word: string) => {
        said.asked.push(word)
        return word ? JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: world.shared }] }) : ''
      },
      sharedDone: () => {
        world.done++
      },
    })[name],
  answer: () => undefined,
}))
vi.mock('./widgets.svelte', () => ({ watchWidgets: () => () => undefined }))
vi.mock('../../panes/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../panes/src/api')>()),
  views: { of: () => (world.open ? { state: { readOnly: false } } : null) },
}))
vi.mock('../../commands/src/api', () => ({
  appCommands: () => [],
  putPicture: () => undefined,
  writeAtCaret: (_view: unknown, words: string) => void world.typed.push(words),
}))
vi.mock('../../ui-kit/src/api', async (original) => ({
  ...(await original<typeof import('../../ui-kit/src/api')>()),
  prompt: {
    choose: (question: { options: { id: string }[] }) => {
      world.asked.push(question)
      return Promise.resolve(world.answer)
    },
  },
}))
vi.mock('../../tasks-model/src/api', async (original) => ({
  ...(await original<typeof import('../../tasks-model/src/api')>()),
  addTask: (_text: string, options: { root?: string; typed?: boolean } = {}) => {
    world.tasks.push(options)
    return Promise.resolve({ path: `${options.root}/Inbox.md`, line: 0 })
  },
  tickTask: () => {
    world.ticked++
    return Promise.resolve()
  },
}))
vi.mock('../../workspace/src/api', () => ({
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
const MINE = { id: 'mine', name: 'Mine', root: '/mine' }
test('Orden Notes takes shared words as a note, offers no todo for them, and ticks none', async () => {
  world.readOnly = []
  world.spaces = [MINE]
  world.handed = JSON.stringify({ command: 'quick-add', tick: '/mine/Inbox.md:3' })
  said.word = 'word'
  const stop = startHanded()
  await vi.waitFor(() => expect(imported).toHaveLength(1))
  expect(world.asked.map((one) => one.options.map((option) => option.id))).toEqual([['new']])
  expect(world.done).toBe(1)
  expect(world.tasks).toEqual([])
  expect(world.ticked).toBe(0)
  stop()
})
