import { expect, test, vi } from 'vitest'

const DIARY = '/notes/Work/Private/Diary.md'
const diary = {}
const sent: unknown[] = []

vi.mock('../../protect/src/api', async (original) => ({
  ...(await original<typeof import('../../protect/src/api')>()),
  protection: { agentsMay: (path: string) => !path.startsWith('/notes/Work/Private') },
}))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    active: { kind: 'note', path: DIARY },
    tabs: [{ kind: 'note', path: DIARY, note: { live: diary } }],
  },
}))

vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  complete: async (ask: unknown) => {
    sent.push(ask)
    return ''
  },
  wasStopped: () => false,
  ai: { providerFor: () => ({ id: 'p', model: 'm' }) },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  askSheet: () => Promise.resolve(),
}))

const { answer } = await import('./answering')
const { rewriting } = await import('./rewriting.svelte')

test('an AI block or a rewrite in a note shut to agents sends nothing to the model', async () => {
  await expect(
    answer(
      {
        prompt: 'Summarise this note',
        note: 'secret words',
        doc: diary as never,
        place: null,
        started: () => undefined,
        wrote: () => undefined,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow()

  rewriting.show({
    state: {
      readOnly: false,
      selection: { main: { empty: false, from: 0, to: 6 } },
      doc: { sliceString: () => 'secret' },
    },
  } as never)
  rewriting.run('shorter')
  expect(rewriting.trouble).toMatch(/shut to agents/)
  expect(sent).toEqual([])
})

test('an AI block in a hover card over a note shut to agents is refused, though the note in front is open', async () => {
  const { workspace } = await import('../../workspace/src/api')
  Object.assign(workspace, { active: { kind: 'note', path: '/notes/Work/Open.md' } })
  await expect(
    answer(
      {
        prompt: 'Summarise this note',
        note: 'secret words',
        doc: null,
        place: DIARY,
        started: () => undefined,
        wrote: () => undefined,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow()
  expect(sent).toEqual([])
})
