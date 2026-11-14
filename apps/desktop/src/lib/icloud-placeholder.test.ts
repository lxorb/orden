import { beforeEach, expect, test, vi } from 'vitest'

const crate = vi.hoisted(() => ({
  native: true,
  answer: (): Promise<unknown> => Promise.resolve(false),
}))
vi.mock('./platform/src/tauri', () => ({
  get isNative() {
    return crate.native
  },
  invoke: () => crate.answer(),
}))

const { evictedHere, placeholderOf } = await import('./icloud-placeholder')

beforeEach(() => {
  crate.native = true
})

test('a placeholder sits beside the file, dotted', () => {
  expect(placeholderOf('/s/ideas/Plan.md')).toBe('/s/ideas/.Plan.md.icloud')
})

test('the crate says whether a note is on a cloud’s side', async () => {
  crate.answer = () => Promise.resolve(true)
  expect(await evictedHere('/s/Plan.md')).toBe(true)
  crate.answer = () => Promise.resolve(false)
  expect(await evictedHere('/s/Plan.md')).toBe(false)
})

test('a question that went wrong is no delete: a delete goes to every device', async () => {
  crate.answer = () => Promise.reject(new Error('refused'))
  expect(await evictedHere('/s/Plan.md')).toBe(true)
})

test('where no crate is, nothing is evicted', async () => {
  crate.native = false
  crate.answer = () => Promise.reject(new Error('no crate'))
  expect(await evictedHere('/s/Plan.md')).toBe(false)
})
