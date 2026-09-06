import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
})

afterEach(() => env.close())

function patch(body: unknown, as = token) {
  return call(env, '/v1/settings', { method: 'PATCH', token: as, body })
}

describe('account settings', () => {
  test('start empty', async () => {
    const response = await call(env, '/v1/settings', { token })
    expect(response.status).toBe(200)
    expect(response.json.settings).toEqual({})
  })

  test('keep what is chosen', async () => {
    const set = await patch({ ligatures: true })
    expect(set.status).toBe(200)
    expect(set.json.settings).toEqual({ ligatures: true })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true })
  })

  test('a change leaves the rest as it was', async () => {
    await patch({ ligatures: true })
    expect((await patch({})).json.settings).toEqual({ ligatures: true })
    expect((await patch({ ligatures: false })).json.settings).toEqual({ ligatures: false })
  })

  test('refuse what the app does not know', async () => {
    expect((await patch({ colour: 'red' })).status).toBe(400)
    expect((await patch({ ligatures: 'yes' })).status).toBe(400)
    expect((await patch([true])).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })

  test('are the account’s alone', async () => {
    const other = await signIn(env, 'c@d.dev')
    await patch({ ligatures: true })
    expect((await call(env, '/v1/settings', { token: other })).json.settings).toEqual({})
    expect((await call(env, '/v1/settings')).status).toBe(401)
  })
})

describe('the shortcuts an account carries', () => {
  test('keep a map of keys', async () => {
    const set = await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })
  })

  test('take a key that was taken away', async () => {
    const set = await patch({ shortcuts: { 'format.bold': null } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': null })
  })

  test('take the awkward combinations the app really writes', async () => {
    const keys = {
      'paragraph.heading-down': 'Mod--',
      'paragraph.ordered-list': 'Mod-Shift-[',
      'format.clear': 'Mod-\\',
      'format.code': 'Mod-Shift-`',
      'app.zoom-in': 'Mod-Shift-=',
      'table.below': 'ArrowDown',
      'edit.redo.alt': 'Ctrl-Shift-z',
    }

    expect((await patch({ shortcuts: keys })).status).toBe(200)
  })

  test('keep an id this version has never heard of', async () => {
    // A newer app may bind something this server knows nothing about. The id
    // is checked for shape, not against a list, so it survives.
    expect((await patch({ shortcuts: { 'something.new': 'Mod-9' } })).status).toBe(200)
  })

  test('refuse an id that is not one', async () => {
    expect((await patch({ shortcuts: { 'Format Bold': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { '../etc': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { ['a'.repeat(65)]: 'Mod-b' } })).status).toBe(400)
  })

  test('refuse a value that is not a key', async () => {
    expect((await patch({ shortcuts: { 'format.bold': 'Hyper-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 'Mod b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': '' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 7 } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': { key: 'Mod-b' } } })).status).toBe(400)
  })

  test('refuse anything but a map', async () => {
    expect((await patch({ shortcuts: [] })).status).toBe(400)
    expect((await patch({ shortcuts: 'Mod-b' })).status).toBe(400)
    expect((await patch({ shortcuts: null })).status).toBe(400)
  })

  test('refuse more than an account holds', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`app.thing-${index}`, 'Mod-b']),
    )

    expect((await patch({ shortcuts: many })).status).toBe(400)
  })

  test('refuse a body too big for the column', async () => {
    // Every entry is legal on its own; together they are more than the row
    // will carry, which is the other end of the same guard.
    const big = Object.fromEntries(
      Array.from({ length: 199 }, (_, index) => [
        `app.${'thing'.repeat(10)}-${index}`,
        'Mod-Alt-Shift-ArrowDown',
      ]),
    )

    expect((await patch({ shortcuts: big })).status).toBe(413)
  })

  test('leave nothing behind when they are refused', async () => {
    await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    await patch({ shortcuts: { 'format.bold': 'nonsense key' } })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b' })
  })

  test('sit beside the other settings rather than replacing them', async () => {
    await patch({ ligatures: true })
    await patch({ shortcuts: { 'app.save': 'F2' } })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true, shortcuts: { 'app.save': 'F2' } })
  })
})
