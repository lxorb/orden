import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, joined, signIn, testEnv, type TestEnv } from './harness'

type Field = 'archived' | 'excluded' | 'graph' | 'bookmarks' | 'arranged' | 'icons' | 'tints' | 'sort'
export function aSpace() {
  const at = {} as { env: TestEnv; token: string; space: string }
  beforeEach(async () => {
    at.env = testEnv()
    at.token = await signIn(at.env, 'a@b.dev')
    at.space = (await call(at.env, '/v1/spaces', { token: at.token, body: { name: 'Notes' } })).json.space.id
  })
  afterEach(() => at.env.close())
  return at
}
export function spaceField(field: Field, route: string = field) {
  const at = aSpace()
  const put = (value: unknown, options: { as?: string; id?: string; tints?: unknown } = {}) =>
    call(at.env, `/v1/spaces/${options.id ?? at.space}/${route}`, {
      method: 'PUT',
      token: options.as ?? at.token,
      body: { [field]: value, ...(options.tints === undefined ? {} : { tints: options.tints }) },
    })
  const listed = async (as = at.token, which: Field = field) =>
    (await call(at.env, '/v1/spaces', { token: as })).json.spaces.find((one) => one.id === at.space)?.[which]
  const column = (raw: string, which: Field = field) =>
    at.env.db.prepare(`update spaces set ${which} = ? where id = ?`).run(raw, at.space)
  const reader = () => joined(at.env, at.token, at.space, 'c@d.dev', 'read')
  function kept(empty: unknown, whole: unknown, replacement: unknown) {
    describe(`what a space holds as ${field}`, () => {
      test('starts as nothing', async () => {
        expect(await listed()).toEqual(empty)
      })
      test('is kept whole, and rides the space listing', async () => {
        const set = await put(whole)
        expect(set.status).toBe(200)
        expect(set.json[field]).toEqual(whole)
        expect(await listed()).toEqual(whole)
      })
      test('is replaced by what arrives, and goes away when nothing arrives', async () => {
        await put(whole)
        await put(replacement)
        expect(await listed()).toEqual(replacement)
        await put(empty)
        expect(await listed()).toEqual(empty)
      })
      test('marks the space as changed, so another device notices', async () => {
        const changed = async () =>
          (await call(at.env, '/v1/spaces', { token: at.token })).json.spaces[0]?.updatedAt ?? 0
        const before = await changed()
        await put(whole)
        expect(await changed()).toBeGreaterThanOrEqual(before)
      })
      test('is refused when the body is not an object at all', async () => {
        const sent = await call(at.env, `/v1/spaces/${at.space}/${route}`, {
          method: 'PUT',
          token: at.token,
          body: [whole],
        })
        expect(sent.status).toBe(400)
      })
    })
  }
  function owned(empty: unknown, whole: unknown, readers = true) {
    describe(`the ${field} are the space’s`, () => {
      if (readers) {
        test('so everybody in it reads the same', async () => {
          const theirs = await reader()
          await put(whole)
          expect(await listed(theirs)).toEqual(whole)
        })
        test('and writing them is writing in the space, which a reader may not', async () => {
          expect((await put(whole, { as: await reader() })).status).toBe(403)
          expect(await listed()).toEqual(empty)
        })
      }
      test('are not another account’s to write', async () => {
        const other = await signIn(at.env, 'e@f.dev')
        expect((await put(whole, { as: other })).status).toBe(404)
        expect(await listed()).toEqual(empty)
      })
      test('need a session at all', async () => {
        const sent = await call(at.env, `/v1/spaces/${at.space}/${route}`, { method: 'PUT' })
        expect(sent.status).toBe(401)
      })
      test('answer 404 for a space that is not there', async () => {
        expect((await put(whole, { id: 'nope' })).status).toBe(404)
      })
    })
  }
  return { at, put, listed, column, reader, kept, owned }
}
