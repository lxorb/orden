import { expect, test, vi } from 'vitest'

const listen = vi.fn(() => true)
const held = { on: 0, off: 0 }

vi.mock('../platform/src/mobile-bridge', () => ({
  frameWord: () => Promise.resolve(''),
  method: (name: string) => (name === 'listen' ? listen : undefined),
  answer: () => undefined,
}))
vi.mock('../ui-kit/src/busy.svelte', () => ({
  busy: {
    start: (_label: string, run: () => Promise<void>) => {
      held.on++
      void run().then(() => held.off++)
    },
  },
}))
vi.mock('../insert-picture', () => ({ writeAtCaret: () => undefined }))
vi.mock('../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../workspace.svelte', () => ({ workspace: { panes: { focusedId: 'a' } } }))

const { dictating, toggle } = await import('./dictating')

test('a microphone the activity was not asked for with a word is not listening', async () => {
  toggle({} as Parameters<typeof toggle>[0])
  expect(dictating()).toBe(true)

  await vi.waitFor(() => expect(dictating()).toBe(false))
  expect(listen).not.toHaveBeenCalledWith('', true)
  await vi.waitFor(() => expect(held.off).toBe(1))
})
