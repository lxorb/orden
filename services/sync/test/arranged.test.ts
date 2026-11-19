import { describe, expect, test } from 'vitest'
import { isName, readArranged } from '../src/sync-server-engine/src/spaces/arranged'
import { call } from './harness'
import { spaceField } from './space-field'

const { at, put, listed, column, kept, owned } = spaceField('arranged')

const ARRANGED = {
  Work: ['Plan.md', 'Ideas', 'Old.md'],
  'Work/Ideas': ['Best.md', 'Rest.md'],
}

kept({}, ARRANGED, { Work: ['Plan.md'] })
owned({}, ARRANGED)

describe("the order a space's folders were arranged into", () => {
  test('drops a folder whose list comes to nothing', async () => {
    const set = await put({ ...ARRANGED, Travel: [] })

    expect(set.json.arranged).toEqual(ARRANGED)
  })
})

describe('what one folder may hold', () => {
  test('is the names of its children, each once and in the order they arrived', async () => {
    const set = await put({ Work: ['b.md', 'a.md', 'b.md', 'c.md', 'a.md'] })

    expect(set.json.arranged).toEqual({ Work: ['b.md', 'a.md', 'c.md'] })
  })

  test('and never a path, nor a way out of the folder', () => {
    expect(isName('Plan.md')).toBe(true)
    expect(isName('..hidden.md')).toBe(true)
    expect(isName('a'.repeat(255))).toBe(true)
    expect(isName('a'.repeat(256))).toBe(false)

    expect(isName('')).toBe(false)
    expect(isName('.')).toBe(false)
    expect(isName('..')).toBe(false)
    expect(isName('Work/Plan.md')).toBe(false)
    expect(isName(String.raw`..\..\Plan.md`)).toBe(false)
    expect(isName('/etc/passwd')).toBe(false)
  })

  test('and never a name that is two names to whatever reads it', () => {
    expect(isName('Plan\nOld.md')).toBe(false)
    expect(isName('Plan\u0000.md')).toBe(false)
    expect(isName('Old plan.md')).toBe(true)
  })

  test('so a name that is a path or a climb out of one is dropped', async () => {
    const set = await put({
      Work: ['Plan.md', 'Ideas/Best.md', '..', '.', String.raw`..\secret`, '', 7, null, {}],
    })

    expect(set.status).toBe(200)
    expect(set.json.arranged).toEqual({ Work: ['Plan.md'] })
  })

  test('and a list longer than one gets is cut rather than refused', async () => {
    const many = Array.from({ length: 501 }, (_one, at) => `${at}.md`)
    const set = await put({ Work: many })

    expect(set.status).toBe(200)
    expect(set.json.arranged.Work).toHaveLength(500)
    expect(set.json.arranged.Work).toEqual(many.slice(0, 500))
  })
})

describe('an entry that is not a folder of this space with an order on it', () => {
  test('is dropped when the key is not a path inside the space', async () => {
    for (const path of ['/etc', '../secret', 'a/../../b', String.raw`C:\secret`, 'C:/secret']) {
      const set = await put({ [path]: ['Plan.md'], Work: ['Plan.md'] })

      expect(set.status, path).toBe(200)
      expect(set.json.arranged, path).toEqual({ Work: ['Plan.md'] })
    }
  })

  test('takes a key with dots in a name of its own', async () => {
    expect((await put({ 'Work/..hidden': ['Plan.md'] })).json.arranged).toEqual({
      'Work/..hidden': ['Plan.md'],
    })
  })

  test('takes a folder named the way an object names its prototype', async () => {
    const sent: unknown = JSON.parse('{"__proto__":["Plan.md"],"Work":["Plan.md"]}')
    const set = await put(sent)

    expect(Object.keys(set.json.arranged).sort()).toEqual(['Work', '__proto__'])
    expect(Object.getOwnPropertyDescriptor(set.json.arranged, '__proto__')?.value).toEqual(['Plan.md'])
  })

  test('is dropped when the value is not a list of names at all', async () => {
    for (const order of ['Plan.md', 7, null, {}, { 0: 'Plan.md' }, true]) {
      const set = await put({ Bad: order, Work: ['Plan.md'] })

      const said = JSON.stringify(order)
      expect(set.status, said).toBe(200)
      expect(set.json.arranged, said).toEqual({ Work: ['Plan.md'] })
    }
  })

  test('leaves the rest of the tree arranged, the map being written whole', async () => {
    await put({ ...ARRANGED, '../elsewhere': ['Plan.md'], Travel: 'Plan.md' })

    expect(await listed()).toEqual(ARRANGED)
  })
})

describe('the top of the space', () => {
  test('is a key like any other, and rides the space listing', async () => {
    const set = await put({ '': ['b.md', 'a.md'] })

    expect(set.status).toBe(200)
    expect(set.json.arranged).toEqual({ '': ['b.md', 'a.md'] })
    expect(await listed()).toEqual({ '': ['b.md', 'a.md'] })
  })

  test('sits beside the folders inside it', async () => {
    const whole = { '': ['Work', 'Read me.md'], ...ARRANGED }

    expect((await put(whole)).json.arranged).toEqual(whole)
    expect(await listed()).toEqual(whole)
  })

  test('and is still the only key with no name in it', async () => {
    const set = await put({ '': ['a.md'], '/etc': ['a.md'], '../up': ['a.md'], 'C:/x': ['a.md'] })

    expect(set.json.arranged).toEqual({ '': ['a.md'] })
  })
})

describe('a map that is not one', () => {
  test('is refused', async () => {
    expect((await put([['Plan.md']])).status).toBe(400)
    expect((await put('Plan.md')).status).toBe(400)
    expect((await put(null)).status).toBe(400)
    expect((await put(undefined)).status).toBe(400)
  })

  test('is refused when the body is not an object at all', async () => {
    const sent = await call(at.env, `/v1/spaces/${at.space}/arranged`, {
      method: 'PUT',
      token: at.token,
      body: [ARRANGED],
    })

    expect(sent.status).toBe(400)
  })

  test('says what is wrong with it', async () => {
    expect((await put('Plan.md')).json.error).toBe('arranged must be a map')
  })

  test('leaves what was there as it was', async () => {
    await put(ARRANGED)
    await put('nonsense')

    expect(await listed()).toEqual(ARRANGED)
  })
})

describe('more arranged folders than a space holds', () => {
  const many = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_one, at) => [`${at}`, ['Plan.md']]))

  test('is refused by the count, at the number the app holds itself to', async () => {
    expect((await put(many(200))).status).toBe(200)

    const past = await put(many(201))
    expect(past.status).toBe(400)
    expect(past.json.error).toBe('arranged holds at most 200 folders')
  })

  test('is refused by the size, when every entry is legal on its own', async () => {
    const names = Array.from({ length: 12 }, (_one, at) => `${'n'.repeat(200)}${at}.md`)
    const heavy = Object.fromEntries(Array.from({ length: 200 }, (_one, at) => [`${at}`, names]))

    expect((await put(heavy)).status).toBe(413)
    expect(await listed()).toEqual({})
  })
})

describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    column(JSON.stringify({ ...ARRANGED, '../elsewhere': ['Plan.md'], Travel: { by: 'size' } }))

    expect(await listed()).toEqual(ARRANGED)
  })

  test('and answers with nothing at all for a column that is not a map', () => {
    expect(readArranged('not json')).toEqual({})
    expect(readArranged('["Work"]')).toEqual({})
    expect(readArranged('null')).toEqual({})
    expect(readArranged('7')).toEqual({})
  })
})
