import { expect, test, vi } from 'vitest'

const pieces = ['So \\', '( x^2 \\', ') and\n\\[', '\n\\frac{1}{2}\n\\', ']\n']
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  complete: async (ask: { stream: (piece: string) => void }) => {
    for (const piece of pieces) ask.stream(piece)
    return pieces.join('')
  },
  wasStopped: () => false,
  ai: { providerFor: () => ({ id: 'p', model: 'm' }) },
}))

const { answer } = await import('./answering')

test('an answer written into a note spells its formulas the note’s way', async () => {
  let written = ''
  let model = ''
  await answer(
    {
      prompt: 'Explain',
      note: null,
      started: (named) => (model = named),
      wrote: (piece) => (written += piece),
    },
    new AbortController().signal,
  )
  expect(model).toBe('m')
  expect(written).toBe('So $x^2$ and\n$$\n\\frac{1}{2}\n$$\n')
})
