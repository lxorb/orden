import { describe, expect, test } from 'vitest'
import { call, signIn } from './harness'
import { spaceField } from './space-field'

const { at, put, listed, column, kept, owned } = spaceField('bookmarks')

const note = { kind: 'note', path: 'Read me.md', text: '' }
const folder = { kind: 'folder', path: 'Work', text: '' }
const heading = { kind: 'heading', path: 'Read me.md', text: 'Why it works' }
const search = { kind: 'search', path: '', text: 'tea' }

kept([], [note, folder, heading, search], [folder, note])
owned([], [note])

describe("a space's bookmarks", () => {
  test('keep only the fields a bookmark has', async () => {
    await put([{ ...note, colour: 'red', run: 'rm -rf' }])
    expect(await listed()).toEqual([note])
  })
})

describe('bookmarks belong to one account', () => {
  test('are not another account’s to read', async () => {
    const other = await signIn(at.env, 'c@d.dev')
    await put([note])

    const theirs = await call(at.env, '/v1/spaces', { token: other })
    expect(theirs.json.spaces.map((one) => one.id)).not.toContain(at.space)
    expect(theirs.json.spaces.flatMap((one) => one.bookmarks)).toEqual([])
  })
})

describe('a list that is not one', () => {
  test('is refused', async () => {
    expect((await put('Read me.md')).status).toBe(400)
    expect((await put({ 0: note })).status).toBe(400)
    expect((await put(null)).status).toBe(400)
  })

  test('says what is wrong with it', async () => {
    expect((await put('x')).json.error).toBe('bookmarks must be a list')
    expect((await put([7])).json.error).toBe('a bookmark must be an object')
    expect((await put([{ kind: 'tag', path: '', text: 'x' }])).json.error).toContain('what kind')
  })

  test('leaves what was there as it was', async () => {
    await put([note])
    await put([{ kind: 'nonsense' }])

    expect(await listed()).toEqual([note])
  })
})

describe('a bookmark of a graph view', () => {
  const view = { kind: 'graph', path: '', text: 'Work', view: '{"filter":"tag:work"}' }

  test('keeps the view it carries', async () => {
    const set = await put([view])
    expect(set.status).toBe(200)
    expect(set.json.bookmarks).toEqual([view])
    expect(await listed()).toEqual([view])
  })

  test('and refuses one longer than a view ever is', async () => {
    expect((await put([{ ...view, view: 'a'.repeat(401) }])).status).toBe(400)
    expect((await put([{ ...view, view: 'a'.repeat(400) }])).status).toBe(200)
    expect((await put([{ ...view, view: 7 }])).status).toBe(400)
  })

  test('a view on any other kind is kept as it was sent', async () => {
    expect((await put([{ kind: 'note', path: 'a.md', text: '', view: '{}' }])).status).toBe(200)
  })
})

describe('a bookmark past its bounds', () => {
  test('is refused for a kind nothing knows', async () => {
    expect((await put([{ kind: 'tag', path: 'a', text: '' }])).status).toBe(400)
    expect((await put([{ path: 'a', text: '' }])).status).toBe(400)
  })

  test('is refused for a path or a text that is not one', async () => {
    expect((await put([{ kind: 'note', path: 7, text: '' }])).status).toBe(400)
    expect((await put([{ kind: 'note', path: 'a', text: null }])).status).toBe(400)
  })

  test('is refused for a path longer than a path', async () => {
    expect((await put([{ kind: 'note', path: 'a'.repeat(301), text: '' }])).status).toBe(400)
    expect((await put([{ kind: 'note', path: 'a'.repeat(300), text: '' }])).status).toBe(200)
  })

  test('is refused for a text longer than a heading', async () => {
    expect((await put([{ kind: 'search', path: '', text: 'a'.repeat(201) }])).status).toBe(400)
    expect((await put([{ kind: 'search', path: '', text: 'a'.repeat(200) }])).status).toBe(200)
  })

  test('is refused when the path is not inside the space', async () => {
    for (const path of ['/etc/passwd', '../secret.md', 'a/../../b.md', String.raw`C:\secret.md`]) {
      expect((await put([{ kind: 'note', path, text: '' }])).status, path).toBe(400)
    }
  })

  test('takes a path with dots in a name of its own', async () => {
    expect((await put([{ kind: 'note', path: 'Work/..hidden/a.md', text: '' }])).status).toBe(200)
  })
})

describe('more bookmarks than a space holds', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, at) => ({ kind: 'note', path: `${at}.md`, text: '' }))

  test('is refused by the count', async () => {
    expect((await put(many(60))).status).toBe(200)
    expect((await put(many(61))).status).toBe(400)
  })

  test('is refused by the size, when every entry is legal on its own', async () => {
    const big = Array.from({ length: 60 }, (_, at) => ({
      kind: 'note',
      path: `${'folder/'.repeat(40)}${at}.md`,
      text: 'a'.repeat(200),
    }))

    expect((await put(big)).status).toBe(413)
    expect(await listed()).toEqual([])
  })
})

describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    column(JSON.stringify([note, { kind: 'tag', path: '', text: 'tea' }, 7]))

    expect(await listed()).toEqual([note])
  })

  test('is read as nothing when it is not a list at all', async () => {
    column('not json')
    expect(await listed()).toEqual([])

    column('{"a":1}')
    expect(await listed()).toEqual([])
  })
})
