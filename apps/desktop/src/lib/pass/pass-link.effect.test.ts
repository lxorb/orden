import { newKey } from '@orden/pass/crypto'
import { blank } from '@orden/pass/envelope'
import type { Content } from '@orden/pass/types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LinkWorld } from './link-page'
import { shownLink } from './link-page'
import { base64url, sealedLink } from './link-seal'

const ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const PATH = `/pass-link/${ID}`

interface Seen {
  world: LinkWorld
  asked: string[]
  replaced: string[]
  copied: string[]
}

function worldAt(hash: string, answer: () => Promise<Response>): Seen {
  const asked: string[] = []
  const replaced: string[] = []
  const copied: string[] = []
  const world: LinkWorld = {
    location: { pathname: PATH, search: '', hash },
    history: {
      replaceState: (_state, _unused, url) => {
        replaced.push(String(url))
      },
    },
    fetch: (url) => {
      asked.push(url)
      return answer()
    },
    clipboard: {
      writeText: (text) => {
        copied.push(text)
        return Promise.resolve()
      },
    },
    now: () => Date.now(),
  }
  return { world, asked, replaced, copied }
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))

const login: Content = {
  ...blank('login'),
  title: 'Router',
  username: 'admin',
  password: 'hunter2',
  totp: 'JBSWY3DPEHPK3PXP',
  websites: [{ url: 'https://router.example.com', match: 'domain' }],
  note: 'In the hall cupboard',
}

async function sealedFor(content: Content, left: number | null = 1) {
  const key = newKey()
  const body = await sealedLink(key, ID, content)
  return { hash: `#${base64url(key)}`, answer: { body, expires: Date.now() + 3600e3, left } }
}

let root: HTMLElement

function mounted(): HTMLElement {
  root = document.createElement('div')
  document.body.append(root)
  return root
}

afterEach(() => root.remove())

const fieldOf = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)

const buttonIn = (field: HTMLElement | null, text: string) =>
  [...(field?.querySelectorAll('button') ?? [])].find((one) => one.textContent === text)

describe('the secure link page', () => {
  test('takes the key from the address, drops it from history, asks without it, shows the item', async () => {
    const { hash, answer } = await sealedFor(login)
    const seen = worldAt(hash, json(answer))
    expect(await shownLink(mounted(), seen.world)).toBe('open')

    expect(seen.replaced).toEqual([PATH])
    expect(seen.asked).toEqual([`/v1/pass-link/${ID}`])
    expect(seen.asked.join()).not.toContain('#')
    expect(seen.asked.join()).not.toContain(hash.slice(1))

    expect(root.querySelector('.link-title')?.textContent).toBe('Router')
    expect(fieldOf('username')?.textContent).toContain('admin')
    expect(root.textContent).toContain('https://router.example.com')
    expect(root.textContent).toContain('In the hall cupboard')
    expect(root.textContent).toContain('1 view left')

    const password = fieldOf('password')
    expect(password?.textContent).not.toContain('hunter2')
    buttonIn(password, 'Show')?.click()
    expect(password?.textContent).toContain('hunter2')
    buttonIn(password, 'Hide')?.click()
    expect(password?.textContent).not.toContain('hunter2')

    buttonIn(password, 'Copy')?.click()
    await vi.waitFor(() => expect(seen.copied).toEqual(['hunter2']))
    await vi.waitFor(() => expect(buttonIn(password, 'Copied')).toBeDefined())

    const code = fieldOf('totp')
    await vi.waitFor(() =>
      expect(code?.querySelector('.link-value')?.textContent).toMatch(/^\d{3} \d{3}$/),
    )
    expect(code?.textContent).not.toContain('JBSWY3DPEHPK3PXP')
  })

  test('says so when the link has run out', async () => {
    const { hash } = await sealedFor(login)
    const seen = worldAt(hash, json({ error: 'this link has expired' }, 410))
    expect(await shownLink(mounted(), seen.world)).toBe('gone')
    expect(root.textContent).toContain('This link has expired')
  })

  test('says so when there is no such link', async () => {
    const { hash } = await sealedFor(login)
    expect(await shownLink(mounted(), worldAt(hash, json({ error: 'no' }, 404)).world)).toBe(
      'missing',
    )
    expect(root.textContent).toContain('There is no such link')
  })

  test('asks nothing when the key is missing', async () => {
    const seen = worldAt('', json({}))
    expect(await shownLink(mounted(), seen.world)).toBe('incomplete')
    expect(seen.asked).toEqual([])
    expect(seen.replaced).toEqual([])
  })

  test('opens nothing with the wrong key', async () => {
    const { answer } = await sealedFor(login)
    const seen = worldAt(`#${base64url(newKey())}`, json(answer))
    expect(await shownLink(mounted(), seen.world)).toBe('broken')
    expect(root.textContent).not.toContain('hunter2')
  })

  test('says so when the account cannot be reached', async () => {
    const { hash } = await sealedFor(login)
    const seen = worldAt(hash, () => Promise.reject(new TypeError('offline')))
    expect(await shownLink(mounted(), seen.world)).toBe('offline')
  })

  test('says it was the last view', async () => {
    const { hash, answer } = await sealedFor({ ...blank('note'), title: 'Plan', note: 'x' }, 0)
    expect(await shownLink(mounted(), worldAt(hash, json(answer)).world)).toBe('open')
    expect(root.textContent).toContain('This was the last view.')
  })
})
