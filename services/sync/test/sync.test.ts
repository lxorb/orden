import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id
})

afterEach(() => env.close())

async function addNote(path: string, content: string) {
  const response = await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path, content },
  })
  return response
}

describe('spaces', () => {
  test('creating one returns it', async () => {
    const response = await call(env, '/v1/spaces', { token, body: { name: 'Ideas' } })

    expect(response.status).toBe(201)
    expect(response.json.space.name).toBe('Ideas')
    expect(response.json.space.blog.enabled).toBe(false)
  })

  test('a space needs a name', async () => {
    expect((await call(env, '/v1/spaces', { token, body: { name: '  ' } })).status).toBe(400)
  })

  test('listing shows only your own', async () => {
    const other = await signIn(env, 'other@b.dev')
    await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })

    // `Notes` is the space the account was given when it was made; see
    // src/spaces/first.ts. It leads the rail everywhere below.
    const mine = await call(env, '/v1/spaces', { token })
    expect(mine.json.spaces.map((one) => one.name)).toEqual(['Notes', 'Work'])
  })

  test('another account cannot reach your space', async () => {
    const other = await signIn(env, 'other@b.dev')
    const response = await call(env, `/v1/spaces/${space}/changes`, { token: other })

    expect(response.status).toBe(404)
  })

  test('renaming works', async () => {
    const response = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { name: 'Renamed' },
    })

    expect(response.json.space.name).toBe('Renamed')
  })
})

describe('deleting a space', () => {
  test('takes it out of the list', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const listed = await call(env, '/v1/spaces', { token })
    expect(listed.json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('leaves a marker, so a machine that was away learns it went', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const listed = await call(env, '/v1/spaces', { token })
    expect(listed.json.deleted).toEqual([space])
  })

  test('is not reachable afterwards', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const changes = await call(env, `/v1/spaces/${space}/changes`, { token })
    expect(changes.status).toBe(404)
  })

  test('releases its published address for someone else', async () => {
    await call(env, `/v1/spaces/${space}/blog`, {
      token,
      method: 'PUT',
      body: { subdomain: 'mine' },
    })
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const other = await call(env, '/v1/spaces', { token, body: { name: 'Second' } })
    const claim = await call(env, `/v1/spaces/${other.json.space.id}/blog`, {
      token,
      method: 'PUT',
      body: { subdomain: 'mine' },
    })

    expect(claim.status).toBe(200)
  })

  test('keeps the markers to the account that owns them', async () => {
    const other = await signIn(env, 'other@b.dev')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    const theirs = await call(env, '/v1/spaces', { token: other })
    expect(theirs.json.deleted).toEqual([])
  })
})

describe("a space's icon", () => {
  /** The space this file made, as the listing shows it. Looked up by id rather
   *  than by position, because the rail starts with the space the account was
   *  given, which has an icon of its own. */
  async function inRail() {
    const listed = await call(env, '/v1/spaces', { token })
    return listed.json.spaces.find((one) => one.id === space)
  }

  test('starts unset', async () => {
    expect((await inRail())?.icon).toBe(null)
  })

  test('is remembered, so every machine shows the same one', async () => {
    const response = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { icon: 'Briefcase' },
    })

    expect(response.json.space.icon).toBe('Briefcase')
    expect((await inRail())?.icon).toBe('Briefcase')
  })

  test('can be taken off again', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'PATCH', token, body: { icon: 'Briefcase' } })
    const cleared = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { icon: null },
    })

    expect(cleared.json.space.icon).toBe(null)
  })

  test('survives a rename that says nothing about it', async () => {
    await call(env, `/v1/spaces/${space}`, { method: 'PATCH', token, body: { icon: 'Book' } })
    const renamed = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { name: 'Renamed' },
    })

    expect(renamed.json.space.name).toBe('Renamed')
    expect(renamed.json.space.icon).toBe('Book')
  })

  test('keeps the name when only the icon is sent', async () => {
    const response = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { icon: 'Book' },
    })

    expect(response.json.space.name).toBe('Work')
  })

  test('refuses anything that is not an icon name', async () => {
    const response = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token,
      body: { icon: '../../etc/passwd' },
    })

    expect(response.json.space.icon).toBe(null)
  })
})

describe('the order spaces appear in', () => {
  /** Names as the account lists them, which is the rail order. */
  async function order(): Promise<string[]> {
    const listed = await call(env, '/v1/spaces', { token })
    return listed.json.spaces.map((one: { name: string }) => one.name)
  }

  async function idOf(name: string): Promise<string> {
    const listed = await call(env, '/v1/spaces', { token })
    return listed.json.spaces.find((one) => one.name === name)!.id
  }

  beforeEach(async () => {
    await call(env, '/v1/spaces', { token, body: { name: 'Ideas' } })
    await call(env, '/v1/spaces', { token, body: { name: 'Journal' } })
  })

  test('a new space joins the end', async () => {
    expect(await order()).toEqual(['Notes', 'Work', 'Ideas', 'Journal'])
  })

  test('is whatever was last sent', async () => {
    const response = await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token,
      body: {
        order: [
          await idOf('Journal'),
          await idOf('Work'),
          await idOf('Ideas'),
          await idOf('Notes'),
        ],
      },
    })

    expect(response.status).toBe(200)
    expect(await order()).toEqual(['Journal', 'Work', 'Ideas', 'Notes'])
  })

  test('keeps a space the sender left out, rather than losing it', async () => {
    await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token,
      body: { order: [await idOf('Journal'), await idOf('Ideas')] },
    })

    expect(await order()).toEqual(['Journal', 'Ideas', 'Notes', 'Work'])
  })

  test('ignores ids belonging to someone else', async () => {
    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })

    await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token,
      body: { order: [theirs.json.space.id, await idOf('Journal')] },
    })

    expect(await order()).toEqual(['Journal', 'Notes', 'Work', 'Ideas'])
  })

  test('a reorder cannot touch another account', async () => {
    const other = await signIn(env, 'other@b.dev')
    await call(env, '/v1/spaces', { token: other, body: { name: 'First' } })
    await call(env, '/v1/spaces', { token: other, body: { name: 'Second' } })

    await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token,
      body: { order: [await idOf('Journal'), await idOf('Ideas'), await idOf('Work')] },
    })

    const listed = await call(env, '/v1/spaces', { token: other })
    expect(listed.json.spaces.map((one) => one.name)).toEqual(['Notes', 'First', 'Second'])
  })

  test('an order has to be a list', async () => {
    const response = await call(env, '/v1/spaces/order', { method: 'PUT', token, body: {} })
    expect(response.status).toBe(400)
  })

  test('`order` is read as a word, not as a space id', async () => {
    const response = await call(env, '/v1/spaces/order', {
      method: 'PATCH',
      token,
      body: { name: 'Nope' },
    })

    expect(response.status).toBe(404)
  })
})

describe('notes', () => {
  test('creating one stores its content', async () => {
    const created = await addNote('Read me.md', '# Hello')
    expect(created.status).toBe(201)
    expect(created.json.note.version).toBe(1)

    const fetched = await call(env, `/v1/notes/${created.json.note.id}`, { token })
    expect(fetched.json.content).toBe('# Hello')
  })

  test('two notes cannot share a path', async () => {
    await addNote('Read me.md', 'one')
    expect((await addNote('Read me.md', 'two')).status).toBe(409)
  })

  test('rejects a path that climbs out of the space', async () => {
    expect((await addNote('../secrets.md', 'x')).status).toBe(400)
    expect((await addNote('a/../../b.md', 'x')).status).toBe(400)
  })

  test('an absolute path is pulled back inside the space', async () => {
    const created = await addNote('/etc/passwd.md', 'x')
    expect(created.status).toBe(201)
    expect(created.json.note.path).toBe('etc/passwd.md')
  })

  test('rejects a path that is neither a note nor a canvas', async () => {
    expect((await addNote('note.txt', 'x')).status).toBe(400)
    expect((await addNote('paper.pdf', 'x')).status).toBe(400)
  })

  /** A canvas is text that is drawn on from more than one device, so it travels
   *  the way a note does: versioned, hashed, and with the conflict rule behind
   *  it. The blob list beside this only goes up, which would not round trip. */
  test('takes a canvas as a note, and gives it back unchanged', async () => {
    const drawn = '{\n\t"nodes": [],\n\t"edges": []\n}\n'
    const created = await addNote('Boards/Plan.canvas', drawn)

    expect(created.status).toBe(201)
    expect(created.json.note.path).toBe('Boards/Plan.canvas')

    const fetched = await call(env, `/v1/notes/${created.json.note.id}`, { token })
    expect(fetched.json.content).toBe(drawn)
  })

  test('a canvas that changed comes back in the next catch-up', async () => {
    const created = await addNote('Plan.canvas', '{"nodes":[],"edges":[]}')
    await call(env, `/v1/notes/${created.json.note.id}`, {
      method: 'PUT',
      token,
      body: { content: '{"nodes":[{"id":"a"}],"edges":[]}', baseVersion: 1 },
    })

    const page = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    const canvas = (page.json.notes as { path: string; version: number }[]).find(
      (note) => note.path === 'Plan.canvas',
    )

    expect(canvas?.version).toBe(2)
  })

  test('updating raises the version', async () => {
    const created = await addNote('a.md', 'one')
    const updated = await call(env, `/v1/notes/${created.json.note.id}`, {
      method: 'PUT',
      token,
      body: { content: 'two', baseVersion: 1 },
    })

    expect(updated.status).toBe(200)
    expect(updated.json.note.version).toBe(2)
  })

  test('writing identical content is a no-op', async () => {
    const created = await addNote('a.md', 'same')
    const updated = await call(env, `/v1/notes/${created.json.note.id}`, {
      method: 'PUT',
      token,
      body: { content: 'same', baseVersion: 1 },
    })

    expect(updated.json.note.version).toBe(1)
  })

  test('a stale write is refused and hands back the server copy', async () => {
    const created = await addNote('a.md', 'one')
    const id = created.json.note.id

    await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'server', baseVersion: 1 },
    })

    const stale = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'mine', baseVersion: 1 },
    })

    expect(stale.status).toBe(409)
    expect(stale.json.content).toBe('server')
    expect(stale.json.note.version).toBe(2)
  })

  /** A canvas is the one thing a machine can settle on its own: everything on
   *  it has an id and a time, so the union of the two copies keeps every card
   *  both devices drew. Nobody gets a second file to go and find. */
  describe('two devices drawing on one canvas', () => {
    const card = (id: string, at: number) => ({
      nodes: [{ id, type: 'text', x: 0, y: 0, width: 100, height: 50, text: id }],
      edges: [],
      nib: { version: 1, at: { [id]: at } },
    })

    async function drawn(id: string, at: number, base: number) {
      return call(env, `/v1/notes/${canvasId}`, {
        method: 'PUT',
        token,
        body: { content: JSON.stringify(card(id, at)), baseVersion: base },
      })
    }

    let canvasId: string

    beforeEach(async () => {
      const created = await addNote('Plan.canvas', '{"nodes":[],"edges":[]}')
      canvasId = created.json.note.id
    })

    test('keeps what both of them drew rather than refusing the second', async () => {
      await drawn('theirs', 1000, 1)
      const mine = await drawn('mine', 1010, 1)

      expect(mine.status).toBe(200)
      expect(mine.json.note.version).toBe(3)

      const held = await call(env, `/v1/notes/${canvasId}`, { token })
      const canvas = JSON.parse(held.json.content) as { nodes: { id: string }[] }
      expect(canvas.nodes.map((node) => node.id).sort()).toEqual(['mine', 'theirs'])
    })

    test('still refuses a stale write to a note beside it', async () => {
      const created = await addNote('a.md', 'one')
      await call(env, `/v1/notes/${created.json.note.id}`, {
        method: 'PUT',
        token,
        body: { content: 'server', baseVersion: 1 },
      })

      const stale = await call(env, `/v1/notes/${created.json.note.id}`, {
        method: 'PUT',
        token,
        body: { content: 'mine', baseVersion: 1 },
      })

      expect(stale.status).toBe(409)
    })
  })

  test('renaming moves the note without losing content', async () => {
    const created = await addNote('a.md', 'body')
    const moved = await call(env, `/v1/notes/${created.json.note.id}`, {
      method: 'PUT',
      token,
      body: { path: 'Folder/b.md', content: 'body', baseVersion: 1 },
    })

    expect(moved.json.note.path).toBe('Folder/b.md')

    const fetched = await call(env, `/v1/notes/${created.json.note.id}`, { token })
    expect(fetched.json.content).toBe('body')
  })

  test('deleting leaves a tombstone', async () => {
    const created = await addNote('a.md', 'x')
    await call(env, `/v1/notes/${created.json.note.id}`, { method: 'DELETE', token })

    const changes = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(changes.json.notes).toHaveLength(1)
    expect(changes.json.notes[0]!.deleted).toBe(true)
  })

  test('a deleted path can be reused', async () => {
    const created = await addNote('a.md', 'x')
    await call(env, `/v1/notes/${created.json.note.id}`, { method: 'DELETE', token })

    expect((await addNote('a.md', 'again')).status).toBe(201)
  })

  test('another account cannot read your note', async () => {
    const created = await addNote('a.md', 'secret')
    const other = await signIn(env, 'other@b.dev')

    expect((await call(env, `/v1/notes/${created.json.note.id}`, { token: other })).status).toBe(
      404,
    )
  })
})

/** An id is not a permission. Every route that takes one looks it up inside the
 *  signed-in account, so an id from somewhere else is indistinguishable from an
 *  id that was never issued: 404, and nothing about it in the answer. */
describe('an id belonging to another account', () => {
  test('is not found by any route that takes one', async () => {
    const created = await addNote('Secret.md', 'not yours')
    const note = created.json.note.id
    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'mine' },
    })

    const other = await signIn(env, 'other@b.dev')
    const attempts: [string, string][] = [
      ['GET', `/v1/spaces/${space}/changes`],
      ['POST', `/v1/spaces/${space}/notes`],
      ['PATCH', `/v1/spaces/${space}`],
      ['DELETE', `/v1/spaces/${space}`],
      ['PUT', `/v1/spaces/${space}/blog`],
      ['DELETE', `/v1/spaces/${space}/blog`],
      ['GET', `/v1/spaces/${space}/blog/domain`],
      ['GET', `/v1/notes/${note}`],
      ['PUT', `/v1/notes/${note}`],
      ['DELETE', `/v1/notes/${note}`],
      ['POST', `/v1/trash/spaces/${space}/restore`],
      ['POST', `/v1/trash/notes/${note}/restore`],
      ['DELETE', `/v1/trash/notes/${note}`],
      ['DELETE', `/v1/trash/spaces/${space}`],
    ]

    for (const [method, path] of attempts) {
      const response = await call(env, path, {
        method,
        token: other,
        ...(method === 'GET' || method === 'DELETE'
          ? {}
          : { body: { name: 'x', path: 'x.md', content: 'x', subdomain: 'theirs' } }),
      })

      expect(response.status, `${method} ${path}`).toBe(404)
      expect(response.text, `${method} ${path}`).not.toContain('Work')
      expect(response.text, `${method} ${path}`).not.toContain('Secret')
    }

    // And nothing was changed by the asking.
    const mine = await call(env, '/v1/spaces', { token })
    const work = mine.json.spaces.find((one) => one.id === space)
    expect(work?.name).toBe('Work')
    expect(work?.blog.subdomain).toBe('mine')
    expect((await call(env, `/v1/notes/${note}`, { token })).json.content).toBe('not yours')
  })
})

describe('what a note is made of', () => {
  test('a path or a body that is not text is refused', async () => {
    const bad = [
      { path: 5, content: 'x' },
      { path: 'a.md', content: {} },
      { path: ['a.md'], content: 'x' },
    ]

    for (const body of bad) {
      const response = await call(env, `/v1/spaces/${space}/notes`, { token, body })
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.json.error).toContain('must be text')
    }
  })

  test('a body that is not JSON is refused', async () => {
    const response = await call(env, `/v1/spaces/${space}/notes`, {
      token,
      raw: 'nonsense',
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('send a JSON object')
  })

  test('a version to write against has to be a number', async () => {
    const created = await addNote('a.md', 'one')
    const response = await call(env, `/v1/notes/${created.json.note.id}`, {
      method: 'PUT',
      token,
      body: { content: 'two', baseVersion: '1' },
    })

    expect(response.status).toBe(400)
  })

  /** A path travels into a published page, a mail, a listing and a file on
   *  somebody's disk. A newline in one is not a folder, so it is not a path. */
  test('a control character is not part of a path', async () => {
    const response = await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: `we${String.fromCharCode(7)}ird.md`, content: 'x' },
    })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('that path is not usable')
  })

  test('a space name has to be text', async () => {
    expect((await call(env, '/v1/spaces', { token, body: { name: 7 } })).status).toBe(400)
  })

  test('an order has to be a list of ids', async () => {
    const response = await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token,
      body: { order: [1, 2] },
    })

    expect(response.status).toBe(400)
  })

  /** The quota is in bytes, so what is counted has to be bytes. Counting
   *  characters let an account keep four times what it was allowed. */
  test('what a note costs is its bytes, not its characters', async () => {
    // What the account already holds is the note it was given; what this
    // measures is what one emoji adds to it.
    const before = (await call(env, '/v1/usage', { token })).json.used
    const created = await addNote('emoji.md', '🙂')

    expect(created.json.note.size).toBe(4)
    expect((await call(env, '/v1/usage', { token })).json.used).toBe(before + 4)
  })
})

describe('catching up', () => {
  test('writes in the same millisecond both reach the cursor', async () => {
    await addNote('one.md', '1')
    await addNote('two.md', '2')
    await addNote('three.md', '3')

    const seen: string[] = []
    let cursor = 0

    // Walk the cursor one step at a time, the way a client resuming would.
    for (let round = 0; round < 5; round++) {
      const page = await call(env, `/v1/spaces/${space}/changes?since=${cursor}`, { token })
      if (!page.json.notes.length) break

      seen.push(...page.json.notes.map((note: { path: string }) => note.path))
      cursor = page.json.cursor
    }

    expect(seen.sort()).toEqual(['one.md', 'three.md', 'two.md'])
  })

  test('a cursor returns only what changed after it', async () => {
    await addNote('one.md', '1')
    const first = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    const cursor = first.json.cursor

    await addNote('two.md', '2')
    const second = await call(env, `/v1/spaces/${space}/changes?since=${cursor}`, { token })

    expect(second.json.notes.map((n: { path: string }) => n.path)).toEqual(['two.md'])
  })

  test('a fresh client gets everything', async () => {
    await addNote('one.md', '1')
    await addNote('two.md', '2')

    const all = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(all.json.notes).toHaveLength(2)
  })
})
