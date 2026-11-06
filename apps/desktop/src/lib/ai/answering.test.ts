import { expect, test, vi } from 'vitest'

const pieces = ['So \\', '( x^2 \\', ') and\n\\[', '\n\\frac{1}{2}\n\\', ']\n']
vi.mock('./complete', () => ({
  complete: async (ask: { stream: (piece: string) => void }) => {
    for (const piece of pieces) ask.stream(piece)
    return pieces.join('')
  },
  wasStopped: () => false,
}))
vi.mock('./store.svelte', () => ({
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
