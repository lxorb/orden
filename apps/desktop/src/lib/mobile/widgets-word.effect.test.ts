import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** The home screen's rows, handed over before the activity has said its word (B456).
 *  The activity drops them and says nothing; taken for drawn, the same rows were never
 *  handed again and the widget stayed as it was. They are handed once the word is
 *  said instead. */

const said = vi.hoisted(() => {
  let speak: (word: string) => void = () => undefined
  const spoken = new Promise<string>((done) => (speak = done))
  return { word: '', spoken, speak: (word: string) => speak(word) }
})
const pushed: string[] = []

vi.mock('./bridge', () => ({
  frameWord: () => Promise.resolve(said.word),
  wordSaid: () => said.spoken,
  method: (name: string) =>
    name === 'widgets'
      ? (word: string) => {
          if (word) pushed.push(word)
        }
      : undefined,
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    tabs: [],
    notes: [],
    archive: new Set(),
    activeSpace: { name: 'Home' },
    spaces: [],
  },
}))
vi.mock('../task-actions', () => ({ listed: () => Promise.resolve({ tasks: [] }) }))
vi.mock('../rows/rows.svelte', () => ({ rows: { watch: () => () => undefined } }))

const { watchWidgets } = await import('./widgets.svelte')

test('rows handed over with no word are handed again once it is said', async () => {
  const stop = watchWidgets()
  flushSync()
  await new Promise((done) => setTimeout(done, 20))
  expect(pushed).toEqual([])

  said.word = 'word'
  said.speak('word')
  await vi.waitFor(() => expect(pushed).toEqual(['word']))
  stop()
})
