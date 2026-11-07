import { blank } from '@orden/pass/envelope'
import type { Item, Role, Vault } from '@orden/pass/types'
import type { LinkRow } from '@orden/pass/wire'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const HOUR = 3600e3
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 6, 12)

interface Signed {
  user: { id: string; email: string; name: string } | null
}

const fake = vi.hoisted(() => {
  const account: Signed = { user: { id: 'ada', email: 'ada@example.com', name: 'Ada' } }
  return {
    pass: { vaults: [] as Vault[], items: [] as Item[], copy: vi.fn() },
    account,
    createLink: vi.fn(),
    links: vi.fn(),
    removeLink: vi.fn(),
    removeExpired: vi.fn(),
  }
})

vi.mock('./store.svelte', () => ({ pass: fake.pass }))
vi.mock('../account.svelte', () => ({ account: fake.account }))
vi.mock('./links', async () => ({
  LINK_LIVES: (await import('./link-make')).LINK_LIVES,
  createLink: fake.createLink,
  links: fake.links,
  removeLink: fake.removeLink,
  removeExpired: fake.removeExpired,
}))

const { PassUi } = await import('./ui.svelte')
const LinkSheet = (await import('./LinkSheet.svelte')).default
const LinksPage = (await import('./LinksPage.svelte')).default

function vaultAs(role: Role): Vault {
  return {
    v: 1,
    id: 'v1',
    name: 'Family',
    description: '',
    color: 'purple',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers: false,
    rev: 1,
    role,
    members: 2,
    shared: true,
  }
}

const ITEM: Item = {
  id: 'i1',
  vault: 'v1',
  folder: null,
  rev: 1,
  content: { ...blank('login'), title: 'Bank', password: 'hunter2' },
  created: 1,
  modified: 1,
  used: null,
  pinned: false,
  trashed: null,
  monitored: true,
} as unknown as Item

const URL_MADE = 'https://orden.so/pass-link/AAAAAAAAAAAAAAAAAAAAAA#key'

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  for (const one of [
    fake.createLink,
    fake.links,
    fake.removeLink,
    fake.removeExpired,
    fake.pass.copy,
  ])
    one.mockReset()
  fake.pass.vaults = [vaultAs('editor')]
  fake.pass.items = [ITEM]
  fake.account.user = { id: 'ada', email: 'ada@example.com', name: 'Ada' }
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  vi.useRealTimers()
})

function sheet() {
  const ui = new PassUi(null)
  ui.sheet = { kind: 'link', item: 'i1' }
  const drawn = mount(LinkSheet, { target, props: { ui }, intro: false })
  close = () => void unmount(drawn)
  flushSync()
  return ui
}

function button(name: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name || one.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

function option(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!found) throw new Error(`no ${name} option`)
  return found
}

function views(): HTMLInputElement {
  return target.querySelector<HTMLInputElement>('input[aria-label="Max views"]')!
}

function typed(field: HTMLInputElement, text: string) {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('making a secure link', () => {
  test('lasts a week with unlimited views unless told otherwise', async () => {
    fake.createLink.mockResolvedValue({ url: URL_MADE, link: {} })
    sheet()
    expect(button('Expires after').textContent).toContain('1 week')
    expect(views().placeholder).toBe('Unlimited')
    button('Create').click()
    await vi.waitFor(() =>
      expect(fake.createLink).toHaveBeenCalledWith(ITEM, { expires: 7 * DAY, views: null }),
    )
  })

  test('offers each life, and takes the one chosen and a view limit', async () => {
    fake.createLink.mockResolvedValue({ url: URL_MADE, link: {} })
    sheet()
    button('Expires after').click()
    flushSync()
    const lives = [...document.querySelectorAll('[role="option"]')].map((one) =>
      one.textContent.trim(),
    )
    expect(lives).toEqual(['1 hour', '1 day', '1 week', '2 weeks', '30 days'])
    option('1 hour').click()
    flushSync()
    typed(views(), '3')
    button('Create').click()
    await vi.waitFor(() =>
      expect(fake.createLink).toHaveBeenCalledWith(ITEM, { expires: HOUR, views: 3 }),
    )
  })

  test('shows the address once made, and copies it', async () => {
    fake.createLink.mockResolvedValue({ url: URL_MADE, link: {} })
    sheet()
    button('Create').click()
    await vi.waitFor(() =>
      expect(target.querySelector<HTMLInputElement>('[data-link-url]')?.value).toBe(URL_MADE),
    )
    button('Copy').click()
    await vi.waitFor(() => expect(fake.pass.copy).toHaveBeenCalledWith(URL_MADE))
  })

  test('refuses a view limit out of range', () => {
    sheet()
    typed(views(), '101')
    expect(button('Create').disabled).toBe(true)
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('1 to 100')
    typed(views(), '0')
    expect(button('Create').disabled).toBe(true)
    typed(views(), '')
    expect(button('Create').disabled).toBe(false)
  })

  test('says what went wrong', async () => {
    fake.createLink.mockRejectedValue(new Error('pass: too many links'))
    sheet()
    button('Create').click()
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain('too many links'),
    )
  })

  test('asks to sign in, and is not offered to a viewer', () => {
    fake.account.user = null
    sheet()
    expect(target.querySelector('[data-signed-out]')?.textContent).toContain('Sign in to share')
    close?.()
    target.replaceChildren()
    fake.account.user = { id: 'ada', email: 'ada@example.com', name: 'Ada' }
    fake.pass.vaults = [vaultAs('viewer')]
    sheet()
    expect(() => button('Create')).toThrow()
  })
})

describe('the secure links page', () => {
  const link = (id: string, more: Partial<LinkRow>): LinkRow => ({
    id,
    vault: 'v1',
    item: 'i1',
    expires: NOW + DAY,
    views: null,
    seen: 0,
    created: NOW - HOUR,
    ...more,
  })

  function page() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const drawn = mount(LinksPage, { target, intro: false })
    close = () => void unmount(drawn)
    flushSync()
  }

  test('lists each link with its item, when it expires and its views, and removes one', async () => {
    fake.links.mockResolvedValue([
      link('a', { expires: NOW + 3 * DAY, views: 5, seen: 2 }),
      link('b', { expires: NOW - HOUR, created: NOW - 2 * DAY, seen: 1 }),
    ])
    fake.removeLink.mockResolvedValue(undefined)
    page()
    await vi.waitFor(() => expect(target.querySelectorAll('[data-link]')).toHaveLength(2))
    const [fresh, over] = [...target.querySelectorAll<HTMLElement>('[data-link]')]
    expect(fresh?.textContent).toContain('Bank')
    expect(fresh?.querySelector('[data-expires]')?.textContent).toBe('in 3 days')
    expect(fresh?.querySelector('[data-views]')?.textContent).toBe('2 of 5 views')
    expect(over?.querySelector('[data-expires]')?.textContent).toBe('Expired')
    expect(over?.querySelector('[data-views]')?.textContent).toBe('1 view')
    expect(() => button('Copy link')).toThrow()

    button('Remove link').click()
    await vi.waitFor(() => expect(fake.removeLink).toHaveBeenCalledWith('a'))
    await vi.waitFor(() => expect(fake.links).toHaveBeenCalledTimes(2))
  })

  test('removes all the expired links at once', async () => {
    fake.links.mockResolvedValueOnce([link('b', { expires: NOW - HOUR })]).mockResolvedValue([])
    fake.removeExpired.mockResolvedValue(1)
    page()
    await vi.waitFor(() => expect(button('Remove all expired links').disabled).toBe(false))
    button('Remove all expired links').click()
    await vi.waitFor(() => expect(fake.removeExpired).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(target.textContent).toContain('No secure links yet'))
  })

  test('asks to sign in', () => {
    fake.account.user = null
    page()
    expect(target.textContent).toContain('Sign in to share')
    expect(fake.links).not.toHaveBeenCalled()
  })
})
