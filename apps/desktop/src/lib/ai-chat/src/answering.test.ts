import { expect, test, vi } from 'vitest'
import type { SharedDoc } from '@orden/editor'

const pieces = ['So \\', '( x^2 \\', ') and\n\\[', '\n\\frac{1}{2}\n\\', ']\n']
const completed = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  complete: async (ask: { stream: (piece: string) => void }) => {
    completed.count++
    for (const piece of pieces) ask.stream(piece)
    return pieces.join('')
  },
  wasStopped: () => false,
  ai: { providerFor: () => ({ id: 'p', model: 'm' }) },
}))

const diary = vi.hoisted(() => ({ live: {}, unsaved: {}, locked: false }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabs: [
      { path: '/notes/Private/Diary.md', note: { live: diary.live } },
      { path: '', note: { live: diary.unsaved } },
    ],
    activeSpace: { root: '/notes' },
  },
}))
vi.mock('../../protect/src/api', () => ({
  protection: {
    get any() {
      return diary.locked
    },
    agentsMay: (path?: string | null) => path !== '/notes/Private/Diary.md',
    agentsMayAll: () => !diary.locked,
  },
}))

const { answer } = await import('./answering')
const { busy } = await import('../../ui-kit/src/api')

test('an answer written into a note spells its formulas the note’s way', async () => {
  let written = ''
  let model = ''
  await answer(
    {
      prompt: 'Explain',
      note: null,
      place: null,
      shows: null,
      started: (named) => (model = named),
      wrote: (piece) => (written += piece),
    },
    new AbortController().signal,
  )
  expect(model).toBe('m')
  expect(written).toBe('So $x^2$ and\n$$\n\\frac{1}{2}\n$$\n')
})

test('a note shut to agents asks nothing of the model, and says why', async () => {
  completed.count = 0
  let written = ''

  await expect(
    answer(
      {
        prompt: 'Summarise @note',
        note: 'Dear diary.',
        shows: diary.live as SharedDoc,
        started: () => undefined,
        wrote: (piece) => (written += piece),
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow()

  expect(completed.count).toBe(0)
  expect(written).toBe('')
  expect(busy.trouble).toContain('Let agents read')
})

test('a document no open note shows asks nothing of the model while the space holds a note shut to agents', async () => {
  completed.count = 0
  diary.locked = true

  await expect(
    answer(
      {
        prompt: 'Summarise @note',
        note: 'Dear diary.',
        shows: {} as SharedDoc,
        started: () => undefined,
        wrote: () => undefined,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow()

  diary.locked = false
  expect(completed.count).toBe(0)
})

test('a note not yet saved is asked about on its own, not for every lock in the space', async () => {
  completed.count = 0
  diary.locked = true

  await answer(
    {
      prompt: 'Explain',
      note: 'Fresh words.',
      shows: diary.unsaved as SharedDoc,
      started: () => undefined,
      wrote: () => undefined,
    },
    new AbortController().signal,
  )

  diary.locked = false
  expect(completed.count).toBe(1)
})
