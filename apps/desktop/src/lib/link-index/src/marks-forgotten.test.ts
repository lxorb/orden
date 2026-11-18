import { expect, test, vi } from 'vitest'

const reads: ((text: string) => void)[] = []

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: (command: string) =>
    command === 'read_note'
      ? new Promise<string>((done) => reads.push(done))
      : Promise.reject(new Error(`no ${command} here`)),
}))

const { elsewhere } = await import('./marks-elsewhere.svelte')

const settled = () => new Promise((done) => setTimeout(done, 10))

test('a mark read for a note forgotten mid read is not kept, and the note is read again', async () => {
  const path = '/other/Plan.md'
  expect(elsewhere.of(path)).toBeNull()
  await settled()
  expect(reads).toHaveLength(1)

  elsewhere.forget(path)
  reads[0]?.('---\nicon: old\n---\n')
  await settled()

  expect(elsewhere.of(path)).toBeNull()
  await settled()
  expect(reads).toHaveLength(2)
  reads[1]?.('---\nicon: new\n---\n')
  await settled()
  expect(elsewhere.of(path)?.icon).toBe('new')
})
