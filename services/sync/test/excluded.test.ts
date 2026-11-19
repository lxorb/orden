import { describe, expect, test } from 'vitest'
import { readExcluded } from '../src/sync-server-engine/src/spaces/excluded'
import { spaceField } from './space-field'

const { put, listed, column, kept, owned } = spaceField('excluded')

const LEFT_OUT = ['Archive', 'Work/Old plan.md']

kept([], LEFT_OUT, ['Archive'])
owned([], LEFT_OUT)

describe('what may be in it', () => {
  test('is a list, and never an object or a word', async () => {
    expect((await put({})).status).toBe(400)
    expect((await put('Archive')).status).toBe(400)
  })

  test('and a path inside the space, never one on somebody else s disk', async () => {
    const set = await put(['Archive', '/etc/passwd', 'C:\\notes', '../outside', 'fine/../also fine', '', 7])

    expect(set.json.excluded).toEqual(['Archive'])
  })

  test('and each path once, in the order it arrived', async () => {
    const set = await put(['b', 'a', 'b'])

    expect(set.json.excluded).toEqual(['b', 'a'])
  })

  test('and more paths than a space leaves out is refused, so nothing is lost', async () => {
    const many = Array.from({ length: 201 }, (_one, index) => `note-${index}.md`)

    expect((await put(many)).status).toBe(400)
    expect((await put(many.slice(0, 200))).status).toBe(200)
  })

  test('and a path longer than a path is dropped rather than refused', async () => {
    const set = await put(['Archive', 'a'.repeat(301)])

    expect(set.json.excluded).toEqual(['Archive'])
  })
})

describe('reading the column back', () => {
  test('keeps the paths and leaves the rest', async () => {
    column('["Archive",{"glob":"*.tmp"},"Work"]')

    expect(await listed()).toEqual(['Archive', 'Work'])
  })

  test('and answers with nothing at all for a column that is not a list', () => {
    expect(readExcluded('not json')).toEqual([])
    expect(readExcluded('{}')).toEqual([])
    expect(readExcluded('null')).toEqual([])
  })
})
