import { expect, test, vi } from 'vitest'

const started = vi.hoisted(() => [] as string[])
const carried = vi.hoisted(() => [] as unknown[])
const sent = vi.hoisted(() => [] as string[])

vi.mock('../../panes/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../panes/src/api')>()),
  views: { of: () => null },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: { panelTab: null, panes: { focusedId: '' }, activeSpace: null, offers: () => true },
}))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  ai: { providerFor: () => ({ id: 'one' }) },
}))
vi.mock('./store/around', () => ({
  noteInFront: () => null,
  selectionHere: () => ({ text: '', picked: null }),
  SELECTION_CHIP: {},
}))
vi.mock('./store/chat.svelte', () => ({
  chat: {
    running: [],
    pending: {},
    watched: {},
    watch: () => undefined,
    unwatch: () => undefined,
    saw: () => Promise.resolve(),
    sendIn: (_thread: unknown, question: string) => {
      sent.push(question)
      return Promise.resolve({ stop: 'end', turn: null, usage: null })
    },
    startHere: (question: string, chips: unknown[]) => {
      started.push(question)
      carried.push(chips)
      return {
        thread: { id: 't', turns: [] },
        ended: Promise.resolve({ stop: 'end', turn: null, usage: null }),
      }
    },
  },
}))

const { quick, side } = await import('./quick.svelte')

test('a question sent just before the quick question closes is still asked', async () => {
  quick.show()
  quick.question = 'Why do herons stand on one leg?'
  const asking = quick.ask()
  quick.close()
  await asking
  expect(started).toEqual(['Why do herons stand on one leg?'])
  expect(quick.turns).toEqual([])
})

test('a second Enter while the first question is still loading starts no second chat', async () => {
  started.length = 0
  quick.show()
  quick.question = 'One'
  const first = quick.ask()
  quick.question = 'Two'
  await quick.ask()
  await first
  expect(started).toEqual(['One'])
  expect(quick.question).toBe('Two')
  quick.close()
})

test('a side chat carries the chat it was opened from, hides without ending, and goes on where it was', async () => {
  started.length = 0
  carried.length = 0
  const main = { id: 'm', title: 'Herons', space: 'work', turns: [{}] }
  side.aside(main as never)
  side.question = 'And egrets?'
  await side.ask()
  expect(started).toEqual(['And egrets?'])
  expect(carried).toEqual([[{ kind: 'thread', id: 'm', label: 'Herons', space: 'work' }]])

  side.close()
  expect(side.open).toBe(false)
  expect(side.of).toBe('m')

  side.aside(main as never)
  side.question = 'Where do they nest?'
  await side.ask()
  expect(started).toEqual(['And egrets?'])
  expect(sent).toEqual(['Where do they nest?'])

  side.end()
  expect(side.of).toBeNull()
  side.aside({ ...main, id: 'n', turns: [] } as never)
  expect(side.context).toBeNull()
  side.question = 'Fresh'
  await side.ask()
  expect(started).toEqual(['And egrets?', 'Fresh'])
  side.end()
})
