import { expect, test, vi } from 'vitest'

/** The share that started the app, asked for before the activity has said its word
 *  (B467). Every call wants the word and does nothing without it, while the activity
 *  keeps the share until it is asked with one; so the page asks again once the word
 *  is said, or the share is never read. */

const world = vi.hoisted(() => ({
  /** The roots of spaces shared with this account to be read. */
  readOnly: ['/theirs'] as string[],
  spaces: [] as { id: string; name: string; root: string }[],
  /** What the sheet answers, and every question it was asked. */
  answer: 'new',
  asked: [] as { options: { id: string }[] }[],
  /** What the activity holds, and how often it was told the share is answered for. */
  shared: 'a link',
  done: 0,
  /** The note open to write in, if any. */
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

const said = vi.hoisted(() => {
  let speak: (word: string) => void = () => undefined
  const spoken = new Promise<string>((done) => (speak = done))
  return { word: '', spoken, speak: (word: string) => speak(word), asked: [] as string[] }
})

vi.mock('./bridge', () => ({
  onTheActivity: () => true,
  frameWord: () => Promise.resolve(said.word),
  wordSaid: () => said.spoken,
  method: (name: string) =>
    ({
      handed: () => '',
      shared: (word: string) => {
        said.asked.push(word)
        return word
          ? JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: world.shared }] })
          : ''
      },
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
vi.mock('../prompt.svelte', () => ({
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

const MINE = { id: 'mine', name: 'Mine', root: '/mine' }

test('a share asked for with no word is asked for again once the word is said', async () => {
  world.readOnly = []
  world.spaces = [MINE]
  const stop = startHanded()
  await new Promise((done) => setTimeout(done, 20))
  expect(imported).toEqual([])

  said.word = 'word'
  said.speak('word')
  await vi.waitFor(() => expect(imported).toHaveLength(1))
  expect(said.asked.filter((one) => one === 'word')).toHaveLength(1)
  expect(world.done).toBe(1)
  stop()
})
