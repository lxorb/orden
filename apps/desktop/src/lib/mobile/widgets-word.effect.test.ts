import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

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
    protection: { seen: '' },
  },
}))
vi.mock('../task-actions', () => ({ listed: () => ({ total: 0, tasks: [] }) }))

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
