import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { slugFor } from '../src/blog'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id

  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Hello world.md', content: '# Hello world\n\nFirst **post**.\n' },
  })
})

afterEach(() => env.close())

async function publish(body: Record<string, unknown>) {
  return call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token, body })
}

async function addNote(path: string, content: string) {
  return call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
}

describe('slugs', () => {
  test('lowercases and hyphenates', () => {
    expect(slugFor('Hello world.md')).toBe('hello-world')
  })

  test('keeps folders as path segments', () => {
    expect(slugFor('Notes/First Idea.md')).toBe('notes/first-idea')
  })

  test('drops punctuation', () => {
    expect(slugFor("What's new?.md")).toBe('what-s-new')
  })
})

describe('while a space is private', () => {
  test('its subdomain sends the visitor to the app', async () => {
    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://nibeditor.com')
  })

  test('a disabled blog stops serving', async () => {
    await publish({ subdomain: 'field' })
    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })

    expect((await call(env, '/', { host: 'field.nibeditor.com' })).status).toBe(302)
  })
})

describe('a name nobody has taken', () => {
  test('forwards to the app, whatever the path', async () => {
    const response = await call(env, '/some/note', { host: 'unused.nibeditor.com' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://nibeditor.com')
  })

  test('the root itself is not forwarded', async () => {
    const response = await call(env, '/', { host: 'nibeditor.com' })
    expect(response.status).not.toBe(302)
  })

  test('a domain of someone else is not forwarded', async () => {
    const response = await call(env, '/', { host: 'notes.example.com' })
    expect(response.status).not.toBe(302)
  })
})

describe('publishing', () => {
  test('a subdomain starts serving the index', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(200)
    expect(response.text).toContain('Field notes')
    expect(response.text).toContain('/hello-world')
  })

  test('a note renders as HTML', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<h1>Hello world</h1>')
    expect(response.text).toContain('<strong>post</strong>')
  })

  test('an unknown slug is handled', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/nothing-here', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Not found')
  })

  test('front matter is not printed', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'meta.md', content: '---\ntitle: Hi\n---\n\nBody text.\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/meta', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('title: Hi')
    expect(response.text).toContain('Body text.')
  })

  test('a custom domain is served', async () => {
    await publish({ domain: 'notes.example.com' })

    const response = await call(env, '/', { host: 'notes.example.com' })
    expect(response.status).toBe(200)
    expect(response.text).toContain('Field notes')
  })

  test('a custom domain comes back with the record to add', async () => {
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.dns).toHaveLength(1)
    expect(response.json.dns[0].type).toBe('CNAME')
    expect(response.json.dns[0].value).toMatch(/\.nibeditor\.com$/)
  })

  test('an apex domain gets a CNAME too, never a placeholder address', async () => {
    const response = await publish({ domain: 'example.com' })
    expect(response.json.dns[0].type).toBe('CNAME')
    expect(response.json.dns[0].value).not.toMatch(/^192\.0\.2\./)
  })

  test('the listing carries the records too, for the next time the pane opens', async () => {
    await publish({ domain: 'notes.example.com' })

    const listed = await call(env, '/v1/spaces', { token })
    const mine = listed.json.spaces.find((one: { id: string }) => one.id === space)
    expect(mine.blog.dns).toHaveLength(1)
    expect(mine.blog.dns[0].type).toBe('CNAME')
  })

  test('a custom title replaces the space name', async () => {
    await publish({ subdomain: 'field', title: 'Notes from the field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Notes from the field')
  })
})

describe('a published note cannot script the reader', () => {
  test('raw HTML in a note is shown, not run', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'nasty.md', content: '# Nasty\n\n<script>alert(1)</script>\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/nasty', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<script>alert(1)</script>')
    expect(response.text).toContain('&lt;script&gt;')
  })

  test('every page forbids scripts outright', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(policy).toContain("script-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('markdown still renders fully', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'rich.md', content: '# Rich\n\n==marked== and $E=mc^2$ and H~2~O\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/rich', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<mark>marked</mark>')
    expect(response.text).toContain('katex')
    expect(response.text).toContain('<sub>2</sub>')
  })
})

describe('one address, not two', () => {
  test('a domain of your own gives the name up', async () => {
    await publish({ subdomain: 'field' })
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.space.blog.subdomain).toBeNull()
    expect(response.json.space.blog.domain).toBe('notes.example.com')
    expect((await call(env, '/', { host: 'field.nibeditor.com' })).status).toBe(302)
  })

  test('the name given up is free for someone else', async () => {
    await publish({ subdomain: 'field' })
    await publish({ domain: 'notes.example.com' })

    expect((await call(env, '/v1/spaces/available/field', { token })).json.available).toBe(true)
  })

  test('choosing a name again lets the domain go', async () => {
    await publish({ domain: 'notes.example.com' })
    const response = await publish({ subdomain: 'field' })

    expect(response.json.space.blog.domain).toBeNull()
    expect(response.json.space.blog.subdomain).toBe('field')
    expect((await call(env, '/', { host: 'notes.example.com' })).status).not.toBe(200)
  })

  test('a domain and a name together keep only the domain', async () => {
    const response = await publish({ subdomain: 'field', domain: 'notes.example.com' })

    expect(response.json.space.blog.subdomain).toBeNull()
    expect(response.json.space.blog.domain).toBe('notes.example.com')
  })

  test('changing only the note keeps the address', async () => {
    await addNote('home.md', '# Hello\n')
    await publish({ subdomain: 'field' })
    const response = await publish({ note: 'home.md' })

    expect(response.status).toBe(200)
    expect(response.json.space.blog.subdomain).toBe('field')
    expect(response.json.space.blog.note).toBe('home.md')
  })

  test('refuses to publish with no address at all', async () => {
    const response = await publish({})

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('choose an address')
  })
})

describe('choosing a subdomain', () => {
  test('reserved names are refused', async () => {
    expect((await publish({ subdomain: 'www' })).status).toBe(409)
    expect((await publish({ subdomain: 'mail' })).status).toBe(409)
  })

  test('a name that is merely plausible is not reserved', async () => {
    expect((await publish({ subdomain: 'blog' })).status).toBe(200)
  })

  test('malformed names are refused', async () => {
    expect((await publish({ subdomain: 'Not Valid' })).status).toBe(400)
    expect((await publish({ subdomain: '-leading' })).status).toBe(400)
  })

  test('a name in use is refused', async () => {
    await publish({ subdomain: 'field' })

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    const response = await call(env, `/v1/spaces/${theirs.json.space.id}/blog`, {
      method: 'PUT',
      token: other,
      body: { subdomain: 'field' },
    })

    expect(response.status).toBe(409)
  })

  test('a name the space already holds is free for that space', async () => {
    await publish({ subdomain: 'field' })

    const mine = await call(env, `/v1/spaces/available/field?space=${space}`, { token })
    expect(mine.json.available).toBe(true)

    const bare = await call(env, '/v1/spaces/available/field', { token })
    expect(bare.json.available).toBe(false)
  })

  test('a name held by one space is not free for another', async () => {
    await publish({ subdomain: 'field' })
    const second = await call(env, '/v1/spaces', { token, body: { name: 'Second' } })

    const response = await call(env, `/v1/spaces/available/field?space=${second.json.space.id}`, {
      token,
    })
    expect(response.json.available).toBe(false)
  })

  test('naming a space that is not yours does not free its name', async () => {
    await publish({ subdomain: 'field' })

    const other = await signIn(env, 'other@b.dev')
    const response = await call(env, `/v1/spaces/available/field?space=${space}`, { token: other })
    expect(response.json.available).toBe(false)
  })

  test('availability can be checked before committing', async () => {
    expect((await call(env, '/v1/spaces/available/free-name', { token })).json.available).toBe(true)

    await publish({ subdomain: 'taken-name' })
    expect((await call(env, '/v1/spaces/available/taken-name', { token })).json.available).toBe(false)
    expect((await call(env, '/v1/spaces/available/www', { token })).json.available).toBe(false)
  })
})

describe('the author', () => {
  test('is named on the index and in the footer once they have a name', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada Lovelace' } })
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).toContain('by Ada Lovelace')
    expect(index.text).toContain('<meta name="author" content="Ada Lovelace">')

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).toContain('Ada Lovelace')
  })

  test('is left out until there is a name', async () => {
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).not.toContain('by ')
    expect(index.text).not.toContain('name="author"')
  })

  test('cannot smuggle markup through the name', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '<b>Ada</b>' } })
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).not.toContain('<b>Ada</b>')
    expect(index.text).toContain('&lt;b&gt;Ada&lt;/b&gt;')
  })

  test('has a byline right under the title of a note', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada Lovelace' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    const title = note.text.indexOf('<h1>Hello world</h1>')
    const byline = note.text.indexOf('<p class="by">by Ada Lovelace</p>')

    expect(title).toBeGreaterThan(-1)
    expect(byline).toBeGreaterThan(title)
    expect(note.text.slice(title, byline)).toBe('<h1>Hello world</h1>')
    expect(note.text).toContain('<meta name="author" content="Ada Lovelace">')
  })

  test('puts the byline first when a note does not start with a heading', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await addNote('plain.md', 'Just a paragraph.\n\n# Later\n')
    await publish({ subdomain: 'field' })

    const note = await call(env, '/plain', { host: 'field.nibeditor.com' })
    const byline = note.text.indexOf('<p class="by">by Ada</p>')

    expect(byline).toBeGreaterThan(-1)
    expect(byline).toBeLessThan(note.text.indexOf('Just a paragraph.'))
    expect(byline).toBeLessThan(note.text.indexOf('<h1>Later</h1>'))
  })

  test('is named under the title of a note published on its own', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await addNote('home.md', '# Home\n\nMy page.\n')
    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text.indexOf('<h1>Home</h1>')).toBeLessThan(root.text.indexOf('by Ada'))
  })

  test('leaves a note without a byline until there is a name', async () => {
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).not.toContain('class="by"')
    expect(note.text).not.toContain('name="author"')
  })

  test('is escaped in the byline of a note too', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '<b>Ada</b>' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).not.toContain('<b>Ada</b>')
    expect(note.text).toContain('by &lt;b&gt;Ada&lt;/b&gt;')
  })

})

/** Every public surface, rendered for an account whose address is known, and
 *  searched for it. The blog is one, but so is anything that answers without
 *  a session; a new public route belongs in this list. */
describe('nothing public carries the email address', () => {
  const EMAIL = 'a@b.dev'
  const PUBLIC = [
    '/',
    '/hello-world',
    '/no-such-note',
    '/feed.xml',
    '/rss.xml',
    '/atom.xml',
    '/sitemap.xml',
    '/robots.txt',
  ]

  async function everywhere(host: string) {
    const seen: string[] = []
    for (const path of PUBLIC) {
      const response = await call(env, path, { host })
      seen.push(`${path}: ${[...response.headers.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`)
      seen.push(`${path}: ${response.text}`)
    }

    // Pages really were rendered, or the search below would prove nothing.
    const text = seen.join('\n')
    expect(text).toContain('Published with')
    return text
  }

  test('not a published space, with a name or without', async () => {
    await publish({ subdomain: 'field' })
    expect(await everywhere('field.nibeditor.com')).not.toContain(EMAIL)

    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    expect(await everywhere('field.nibeditor.com')).not.toContain(EMAIL)
  })

  test('not a note published on its own', async () => {
    await addNote('home.md', '# Home\n')
    await publish({ subdomain: 'me', note: 'home.md' })
    expect(await everywhere('me.nibeditor.com')).not.toContain(EMAIL)
  })

  test('not a domain of their own', async () => {
    await publish({ domain: 'notes.example.com' })
    expect(await everywhere('notes.example.com')).not.toContain(EMAIL)
  })

  test('not the unauthenticated endpoints of the app itself', async () => {
    await publish({ subdomain: 'field' })

    for (const path of [
      '/health',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource/mcp',
      '/mcp',
      '/oauth/authorize',
      '/v1/me',
      '/v1/spaces',
      '/v1/spaces/available/field',
    ]) {
      const response = await call(env, path)
      expect(response.text, path).not.toContain(EMAIL)
    }
  })
})

describe('the way back to the index', () => {
  test('sits above the title of a note', async () => {
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    const back = note.text.indexOf('<a href="/">← Field notes</a>')

    expect(back).toBeGreaterThan(-1)
    expect(back).toBeLessThan(note.text.indexOf('<h1>Hello world</h1>'))
  })

  test('comes before the byline as well', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text.indexOf('← Field notes')).toBeLessThan(note.text.indexOf('by Ada'))
  })

  test('names the blog, escaped', async () => {
    await publish({ subdomain: 'field', title: 'Notes <3' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).toContain('← Notes &lt;3')
  })

  test('is not offered on a note published on its own, which has no index', async () => {
    await addNote('home.md', '# Home\n')
    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text).not.toContain('<a href="/">')
  })
})

describe('publishing one note instead of the space', () => {
  test('serves that note at the root, with no index', async () => {
    await addNote('home.md', '# Hello\n\nMy personal page.\n')
    await addNote('secret.md', '# Secret\n\nNot for the web.\n')

    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })

    expect(root.status).toBe(200)
    expect(root.text).toContain('My personal page.')
    expect(root.text).not.toContain('class="index"')
  })

  test('hides every other note in the space', async () => {
    await addNote('home.md', '# Hello\n')
    await addNote('secret.md', '# Secret\n\nNot for the web.\n')

    await publish({ subdomain: 'me', note: 'home.md' })

    const other = await call(env, '/secret', { host: 'me.nibeditor.com' })
    expect(other.text).not.toContain('Not for the web.')
  })

  test('refuses a note that is not in the space', async () => {
    const response = await publish({ subdomain: 'me', note: 'nowhere.md' })

    expect(response.status).toBe(404)
  })

  test('goes back to the whole space when the note is cleared', async () => {
    await addNote('home.md', '# Hello\n')
    await addNote('other.md', '# Other\n')

    await publish({ subdomain: 'me', note: 'home.md' })
    await publish({ subdomain: 'me', note: null })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text).toContain('class="index"')
  })

  test('reports which note is published', async () => {
    await addNote('home.md', '# Hello\n')
    const published = await publish({ subdomain: 'me', note: 'home.md' })

    expect(published.json.space.blog.note).toBe('home.md')
  })
})

describe('subdomain lengths', () => {
  test('takes the shortest the message promises', async () => {
    expect((await publish({ subdomain: 'me' })).status).toBe(200)
  })

  test('takes the longest', async () => {
    expect((await publish({ subdomain: 'x'.repeat(32) })).status).toBe(200)
  })

  test('refuses one character', async () => {
    expect((await publish({ subdomain: 'x' })).status).toBe(400)
  })

  test('refuses more than thirty-two', async () => {
    expect((await publish({ subdomain: 'x'.repeat(33) })).status).toBe(400)
  })

  test('refuses a leading or trailing hyphen', async () => {
    expect((await publish({ subdomain: '-me' })).status).toBe(400)
    expect((await publish({ subdomain: 'me-' })).status).toBe(400)
  })
})
