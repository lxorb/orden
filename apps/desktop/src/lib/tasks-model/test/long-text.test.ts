import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { addTask as quickAdd } from '../../quick-add/src/write'
import { addTask, LIMITS, todos } from '../src/api'

await todos.opened({ owner: null, server: null, device: 'test' })
const paragraph = `Read the report ${'and the appendix '.repeat(60)}before Friday`
describe('a task added from text longer than a title', () => {
  test.each([false, true])('is kept with the whole text as its description (typed: %s)', async (typed) => {
    const made = await addTask(paragraph, { typed })
    if (!made) throw new Error('not added')
    const todo = todos.todo(made.id)
    expect(todo?.title.length).toBeLessThanOrEqual(LIMITS.title)
    expect(todo?.title.startsWith('Read the report and the appendix')).toBe(true)
    expect(todo?.description).toContain('and the appendix and the appendix')
  })
  test('from quick add keeps the whole text ahead of the description typed under it', async () => {
    const made = await quickAdd({
      text: paragraph,
      description: 'notes',
      fields: { tags: [], remind: [] },
    })
    expect(made?.title.length).toBeLessThanOrEqual(LIMITS.title)
    expect(made?.description).toBe(`${paragraph}\n\nnotes`)
  })
})
describe('a task added from long text in a script of several bytes a character', () => {
  test.each(['あ', 'ü', '😀', '"'])('is kept, its description cut to what reaches the account (%s)', async (letter) => {
    const made = await addTask(letter.repeat(9000), { typed: false })
    if (!made) throw new Error('not added')
    const todo = todos.todo(made.id)
    expect(todo?.description.startsWith(letter.repeat(100))).toBe(true)
    expect(todo?.description).not.toMatch(/\uD83D$/)
    expect(todo?.title).toMatch(/^[^\uD800-\uDBFF]*…$/u)
  })
})
describe('a task added from long text cut where a character of two halves stands', () => {
  test('keeps no half of it at the end of the description', async () => {
    const made = await addTask(`${'a'.repeat(LIMITS.description - 1)}😀b`, { typed: false })
    if (!made) throw new Error('not added')
    expect(todos.todo(made.id)?.description).toBe('a'.repeat(LIMITS.description - 1))
  })
  test('from quick add with a long description typed under it is kept, cut to fit', async () => {
    const made = await quickAdd({
      text: paragraph,
      description: 'n'.repeat(LIMITS.description),
      fields: { tags: [], remind: [] },
    })
    expect(made?.description.startsWith(`${paragraph}\n\nnnn`)).toBe(true)
    expect(made?.description.length).toBeLessThanOrEqual(LIMITS.description)
  })
})
