import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isIcon } from '../src/spaces/icons'
import { call, mail, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
})

afterEach(() => env.close())

function put(icons: unknown, options: { as?: string; id?: string } = {}) {
  return call(env, `/v1/spaces/${options.id ?? space}/icons`, {
    method: 'PUT',
    token: options.as ?? token,
    body: { icons },
  })
}

/** What the space listing says the folders wear, which is how the app reads it. */
async function listed(as = token) {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces.find((one) => one.id === space)?.icons
}

/** The column as somebody else's build left it, which no route would write. */
function column(raw: string) {
  env.db.prepare('update spaces set icons = ? where id = ?').run(raw, space)
}

/** Somebody the owner gave the space to at read, and in it: invited, then having
 *  proved the address by signing in. Which roles every space route lets through
 *  is one matrix in share.test.ts; this is here because the map is the space's,
 *  so being in it is not the same as being allowed to change it. */
async function reader(): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite`, {
      token,
      body: { email: 'c@d.dev', role: 'read' },
    }),
  )

  const link = /\/join\/([a-f0-9]+)/.exec(sent)?.[1]
  if (!link) throw new Error(`no invitation was sent:\n${sent}`)

  const theirs = await signIn(env, 'c@d.dev')
  await call(env, `/v1/join/${link}`, { method: 'POST', token: theirs })
  return theirs
}

/** Two folders wearing an icon, one named the way the picker writes a space's and
 *  one the way a note's front matter writes its own. */
const DRESSED = { Work: 'Briefcase', 'Work/Ideas': 'folder-open' }

describe("a space's folder icons", () => {
  test('start empty', async () => {
    expect(await listed()).toEqual({})
  })

  test('are kept whole, and ride the space listing', async () => {
    const set = await put(DRESSED)
    expect(set.status).toBe(200)
    expect(set.json.icons).toEqual(DRESSED)

    expect(await listed()).toEqual(DRESSED)
  })

  test('are replaced by the map that arrives, which is how a folder is undressed', async () => {
    await put(DRESSED)
    await put({ Work: 'Folder' })

    expect(await listed()).toEqual({ Work: 'Folder' })
  })

  test('go away when an empty map is sent', async () => {
    await put(DRESSED)
    await put({})

    expect(await listed()).toEqual({})
  })

  test('take an emoji, which is what a vault imported from Iconize brings', async () => {
    expect((await put({ Work: '📚', Travel: '🇩🇪' })).status).toBe(200)
    expect(await listed()).toEqual({ Work: '📚', Travel: '🇩🇪' })
  })

  test('mark the space as changed, so another device notices', async () => {
    const before = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0
    await put(DRESSED)
    const after = (await call(env, '/v1/spaces', { token })).json.spaces[0]?.updatedAt ?? 0

    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('what a folder may wear', () => {
  test('is an icon name, in either spelling the app writes one', () => {
    // The picker's library key, Lucide's own plain name, and Iconize's.
    expect(isIcon('FileText')).toBe(true)
    expect(isIcon('file-text')).toBe(true)
    expect(isIcon('LiFileText')).toBe(true)
    expect(isIcon('a'.repeat(64))).toBe(true)
    expect(isIcon('a'.repeat(65))).toBe(false)
    expect(isIcon('-')).toBe(false)
  })

  test('or an emoji, however many code points one takes', () => {
    expect(isIcon('📚')).toBe(true)
    expect(isIcon('🇩🇪')).toBe(true)
    // A skin tone and a zero-width join, which is one icon and seven units.
    expect(isIcon('👩🏽‍🚀')).toBe(true)
    expect(isIcon('🙂'.repeat(9))).toBe(false)
  })

  test('and never nothing, nor something a client could read back as a path', () => {
    expect(isIcon('')).toBe(false)
    expect(isIcon('Work/Ideas')).toBe(false)
    expect(isIcon(String.raw`..\..\icon`)).toBe(false)
    expect(isIcon('open folder')).toBe(false)
  })
})

describe('an entry that is not a folder in this space wearing an icon', () => {
  test('is dropped when the path is not inside the space', async () => {
    for (const path of ['/etc', '../secret', 'a/../../b', String.raw`C:\secret`, '']) {
      const set = await put({ [path]: 'Folder', Work: 'Briefcase' })

      expect(set.status, path).toBe(200)
      expect(set.json.icons, path).toEqual({ Work: 'Briefcase' })
    }
  })

  test('takes a path with dots in a name of its own', async () => {
    expect((await put({ 'Work/..hidden': 'Folder' })).json.icons).toEqual({
      'Work/..hidden': 'Folder',
    })
  })

  test('is dropped when the value is not an icon', async () => {
    for (const icon of ['folder open', 'Work/Ideas', 'a'.repeat(65), '', 7, null, { name: 'x' }]) {
      const set = await put({ Bad: icon, Work: 'Briefcase' })

      const said = JSON.stringify(icon)
      expect(set.status, said).toBe(200)
      expect(set.json.icons, said).toEqual({ Work: 'Briefcase' })
    }
  })

  test('leaves the rest of the tree dressed, the map being written whole', async () => {
    await put({ ...DRESSED, '../elsewhere': 'Folder', Travel: 'rm -rf' })

    expect(await listed()).toEqual(DRESSED)
  })
})

describe('a map that is not one', () => {
  test('is refused', async () => {
    expect((await put(['Briefcase'])).status).toBe(400)
    expect((await put('Briefcase')).status).toBe(400)
    expect((await put(null)).status).toBe(400)
    expect((await put(undefined)).status).toBe(400)
  })

  test('is refused when the body is not an object at all', async () => {
    const sent = await call(env, `/v1/spaces/${space}/icons`, {
      method: 'PUT',
      token,
      body: [DRESSED],
    })

    expect(sent.status).toBe(400)
  })

  test('says what is wrong with it', async () => {
    expect((await put('Briefcase')).json.error).toBe('icons must be a map')
  })

  test('leaves what was there as it was', async () => {
    await put(DRESSED)
    await put('nonsense')

    expect(await listed()).toEqual(DRESSED)
  })
})

describe('more folder icons than a space holds', () => {
  const many = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, at) => [`${at}`, 'Folder']))

  test('is refused by the count, at the number the app holds itself to', async () => {
    expect((await put(many(400))).status).toBe(200)

    const past = await put(many(401))
    expect(past.status).toBe(400)
    expect(past.json.error).toBe('icons holds at most 400 folders')
  })

  test('is refused by the size, when every entry is legal on its own', async () => {
    // Two hundred folders nested as deep as a path may go is more than the column
    // carries, which is the other end of the same guard.
    const deep = Object.fromEntries(
      Array.from({ length: 200 }, (_, at) => [`${'folder/'.repeat(40)}${at}`, 'Folder']),
    )

    expect((await put(deep)).status).toBe(413)
    expect(await listed()).toEqual({})
  })
})

describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    column(JSON.stringify({ ...DRESSED, '../elsewhere': 'Folder', Travel: 7 }))

    expect(await listed()).toEqual(DRESSED)
  })

  test('is read as nothing when it is not a map at all', async () => {
    column('not json')
    expect(await listed()).toEqual({})

    column('["Work"]')
    expect(await listed()).toEqual({})

    column('7')
    expect(await listed()).toEqual({})
  })
})

describe('the icons are the space’s', () => {
  test('so everybody in it reads the same ones', async () => {
    const theirs = await reader()
    await put(DRESSED)

    expect(await listed(theirs)).toEqual(DRESSED)
  })

  test('and dressing a folder is writing in the space, which a reader may not', async () => {
    const theirs = await reader()

    expect((await put({ Work: 'Briefcase' }, { as: theirs })).status).toBe(403)
    expect(await listed()).toEqual({})
  })

  test('are not another account’s to write', async () => {
    const other = await signIn(env, 'e@f.dev')

    // The same answer an id that does not exist gets: nothing about the space
    // leaks, not even that it is there.
    expect((await put(DRESSED, { as: other })).status).toBe(404)
    expect(await listed()).toEqual({})
  })

  test('need a session at all', async () => {
    expect((await call(env, `/v1/spaces/${space}/icons`, { method: 'PUT' })).status).toBe(401)
  })

  test('answer 404 for a space that is not there', async () => {
    expect((await put(DRESSED, { id: 'nope' })).status).toBe(404)
  })
})
