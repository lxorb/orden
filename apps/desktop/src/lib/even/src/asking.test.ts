import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  chosen: null as { id: string; kind: string; model: string } | null,
  asked: [] as { provider: string; model: string; messages: { role: string; content: string }[] }[],
  hits: [] as { name: string; text: string }[],
  queries: [] as unknown[],
}))

vi.mock('../../ai-providers/src/api', () => ({
  ai: { providerFor: (feature: string) => (feature === 'ask' ? world.chosen : null) },
  complete: (ask: {
    provider: { id: string }
    model: string
    messages: { role: string; content: string }[]
  }) => {
    world.asked.push({ provider: ask.provider.id, model: ask.model, messages: ask.messages })
    return Promise.resolve(` Answer from ${ask.provider.id}. `)
  },
}))
vi.mock('../../search/src/api', () => ({
  searchSpace: (
    _root: string,
    query: unknown,
    _terms: string[],
    _limit: number,
    found: (batch: { hits: { name: string; text: string }[] }) => void,
  ) => {
    world.queries.push(query)
    found({ hits: world.hits })
    return Promise.resolve()
  },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: { activeSpace: { root: '/space' }, leftOutOf: () => [] },
}))

const { answerOf, NOT_SET } = await import('./asking')

beforeEach(() => {
  world.chosen = null
  world.asked = []
  world.hits = []
  world.queries = []
})

describe('a question on the glasses', () => {
  for (const kind of ['claude', 'openai', 'gemini', 'compatible']) {
    test(`asks the default account, here ${kind}`, async () => {
      world.chosen = { id: `${kind}-1`, kind, model: `${kind}-model` }
      world.hits = [{ name: 'Trip.md', text: 'The train leaves at 9:40' }]
      expect(await answerOf('When does the train leave?')).toBe(`Answer from ${kind}-1.`)
      expect(world.asked).toHaveLength(1)
      expect(world.asked[0]?.provider).toBe(`${kind}-1`)
      expect(world.asked[0]?.model).toBe(`${kind}-model`)
      expect(world.asked[0]?.messages.at(-1)?.content).toContain(
        'Trip.md: The train leaves at 9:40',
      )
    })
  }

  test('says AI is not set up when there is no default account, and asks nobody', async () => {
    expect(await answerOf('When does the train leave?')).toBe(NOT_SET)
    expect(world.asked).toEqual([])
  })
})
