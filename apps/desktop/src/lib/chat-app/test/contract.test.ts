import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { ChatNav, handedOf, hostFor, openHanded, WIDE } from '../src/api'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const A = `c_${'a'.repeat(32)}`
const B = `c_${'b'.repeat(32)}`
const CHATS = [
  { id: A, space: 'home' },
  { id: B, space: 'work' },
]
describe('the Orden Chat shell', () => {
  test('is a door and its own navigation, so loading the api draws nothing', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual([
      'ChatNav',
      'WIDE',
      'handedOf',
      'hostFor',
      'loadChatApp',
      'openHanded',
      'watchHanded',
      'watchPhone',
    ])
    expect(WIDE).toBe(600)
  })
  test('reaches no workspace, tabs or files', () => {
    const src = join(import.meta.dirname, '..', 'src')
    const reached = readdirSync(src).flatMap((name) =>
      [...readFileSync(join(src, name), 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\/api'/g)].map(
        (found) => found[1],
      ),
    )
    expect([...new Set(reached)].sort()).toEqual(['accounts', 'platform', 'ui-controls', 'ui-kit', 'undo-toast'])
  })
  test('shows one space at a time, the first the account has until one is chosen, and keeps the choice', () => {
    const nav = new ChatNav()
    nav.settle(['home', 'work'])
    expect(nav.space).toBe('home')
    nav.show('work')
    nav.settle(['home', 'work'])
    expect(nav.space).toBe('work')
    expect(new ChatNav().space).toBe('work')
    nav.settle(['home'])
    expect(nav.space).toBe('home')
  })
  test('lists the chats of the space shown alone, and opens one by its id', () => {
    const nav = new ChatNav()
    nav.show('home')
    const host = hostFor(nav, () => CHATS)
    expect(host.here(CHATS).map((one) => one.id)).toEqual([A])
    host.openEntry({ id: A, space: 'home' }, 'm1')
    expect([nav.chat, nav.message, host.isOpen({ id: A, space: 'home' })]).toEqual([A, 'm1', true])
  })
  test('goes back from a chat to the list, then out of the app, and switching space closes the chat', () => {
    const nav = new ChatNav()
    nav.open(A, 'home')
    expect(nav.deep).toBe(true)
    expect(nav.back()).toBe(true)
    expect([nav.chat, nav.back()]).toEqual([null, false])
    nav.open(A, 'home')
    nav.show('work')
    expect(nav.chat).toBeNull()
  })
  test('a push link and a chat link open the chat at its message, in its own space', () => {
    const nav = new ChatNav()
    nav.show('home')
    const host = hostFor(nav, () => CHATS)
    host.followHref(`orden-chat://chat/${B}?message=m9`)
    expect([nav.space, nav.chat, nav.message]).toEqual(['work', B, 'm9'])
    host.followHref(`orden://chat/${A}/m2`)
    expect([nav.space, nav.chat, nav.message]).toEqual(['home', A, 'm2'])
    expect(nav.follow(`orden-chat://chat/c_${'c'.repeat(32)}`, CHATS)).toBe(false)
    expect(nav.chat).toBe(A)
  })
  test('what the phone hands over is read as a link and a reply, and anything else as nothing', () => {
    expect(
      handedOf(JSON.stringify({ link: `orden-chat://chat/${A}?message=m1`, reply: 'On my way', open: 'x' })),
    ).toEqual({
      link: `orden-chat://chat/${A}?message=m1`,
      reply: 'On my way',
    })
    for (const said of ['', 'null', '[]', '{"link":7}']) expect(handedOf(said)).toEqual({ link: '', reply: '' })
  })
  test('a pressed push opens its chat once the chats are there, and a reply typed on it is sent there once', async () => {
    const nav = new ChatNav()
    const posted: [string, string][] = []
    const store = {
      ready: false,
      list: CHATS,
      post: (chat: string, draft: { body: string }) => Promise.resolve(void posted.push([chat, draft.body])),
    }
    let waits = 0
    const waited = () => {
      if (++waits === 3) store.ready = true
      return Promise.resolve()
    }
    const handed = { link: `orden-chat://chat/${B}?message=m9`, reply: ' On my way ' }
    expect(await openHanded(handed, nav, store, waited)).toBe(true)
    expect([nav.space, nav.chat, nav.message, waits]).toEqual(['work', B, 'm9', 3])
    expect(posted).toEqual([[B, 'On my way']])
    expect(await openHanded({ link: '', reply: 'lost' }, nav, store, waited)).toBe(false)
    expect(await openHanded({ link: `orden-chat://chat/c_${'c'.repeat(32)}`, reply: 'lost' }, nav, store, waited)).toBe(
      false,
    )
    expect(posted).toHaveLength(1)
  })
})
