import { describe, expect, test, vi } from 'vitest'

const loads = vi.hoisted(() => ({ next: Promise.resolve<unknown>(undefined) }))
vi.mock('../../accounts/src/api', () => ({
  account: { loadSpaces: () => loads.next },
}))
const { demoted } = await import('./demoted')
describe('a room that finds this account may only read', () => {
  test('marks the note read-only, leaves, asks the account again and joins once it has said', async () => {
    const note = { reads: false }
    const said: string[] = []
    let answer = () => undefined as unknown
    loads.next = new Promise((resolve) => {
      answer = () => resolve(undefined)
    })
    const done = demoted(
      note,
      () => said.push(`left reading ${String(note.reads)}`),
      () => said.push(`joined reading ${String(note.reads)}`),
    )
    expect(said).toEqual(['left reading true'])
    answer()
    await done
    expect(said).toEqual(['left reading true', 'joined reading false'])
  })
  test('stays read-only when the account cannot be asked, and still joins again', async () => {
    const note = { reads: false }
    loads.next = Promise.reject(new Error('offline'))
    let joined = false
    await demoted(
      note,
      () => undefined,
      () => {
        joined = true
      },
    )
    expect(note.reads).toBe(true)
    expect(joined).toBe(true)
  })
})
