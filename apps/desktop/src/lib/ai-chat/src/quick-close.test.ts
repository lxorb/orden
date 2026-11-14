import { expect, test, vi } from 'vitest'

const started = vi.hoisted(() => [] as string[])

vi.mock('../../surfaces.svelte', () => ({ quickSheet: { ask: () => Promise.resolve() } }))
vi.mock('../../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../../workspace.svelte', () => ({
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
    watched: null,
    watch: () => undefined,
    saw: () => Promise.resolve(),
    startHere: (question: string) => {
      started.push(question)
      return {
        thread: { id: 't', turns: [] },
        ended: Promise.resolve({ stop: 'end', turn: null, usage: null }),
      }
    },
  },
}))

const { quick } = await import('./quick.svelte')

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
