import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({
  open: true,
  space: { id: 'Notes', name: 'Notes', root: 'Notes' },
  spaceId: 'space-1',
  item: null as { id: string; path: string } | null,
  who: null as object | null,
  error: null,
  email: 'ada@example.com',
  role: 'write',
  wrongAddress: false,
  busy: false,
  seats: null as { used: number; most: number } | null,
  full: false,
  waiting: () => false,
  invite: () => undefined,
  close: () => undefined,
  setLink: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('../../sharing/src/api', () => ({
  share: store,
  isShared: () => false,
  whoIs: (person: { guest?: string | null; email?: string | null }) => `person:${person.guest ?? person.email ?? ''}`,
}))
const ShareSheet = (await import('./ShareSheet.svelte')).default
const member = (email: string) => ({ email, guest: null, name: null, role: 'write', pending: false })
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(() => {
  store.setLink.mockClear()
  store.item = null
  store.seats = null
  store.full = false
  store.who = {
    owner: { email: 'owner@example.com', name: 'Emil' },
    item: null,
    members: [member('ada@example.com'), member('bob@example.com')],
    requests: [],
    link: null,
  }
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})
function draw() {
  const shown = mount(ShareSheet, { target, intro: false })
  close = () => void unmount(shown)
  flushSync()
}
const field = () => target.querySelector<HTMLInputElement>('input[aria-label="Add people by email"]')
const send = () => target.querySelector<HTMLButtonElement>('button[aria-label="Invite"]')
const link = (mode: string) => ({ url: 'https://orden.so/join/abc', role: 'read', mode })
const shown = (who: object) => Object.assign(store.who ?? {}, who)
const switchOf = (name: string) => target.querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`)
const says = (words: string) => target.textContent.includes(words)
describe('the places in a shared space', () => {
  test('are counted beside who has access', () => {
    store.seats = { used: 3, most: 10 }
    draw()
    expect(target.querySelector('.seats')?.textContent.trim()).toBe('3 of 10 places used')
    expect(field()?.disabled).toBe(false)
    expect(says('This space is full')).toBe(false)
  })
  test('once all taken, shut the field and its button and say why', () => {
    store.seats = { used: 10, most: 10 }
    store.full = true
    draw()
    expect(target.querySelector('.seats')?.textContent.trim()).toBe('10 of 10 places used')
    expect(field()?.disabled).toBe(true)
    expect(send()?.disabled).toBe(true)
    expect(says('This space is full. Remove someone to invite more.')).toBe(true)
  })
  test('more in than it holds still shuts the field, and lists everybody', () => {
    store.seats = { used: 12, most: 10 }
    store.full = true
    draw()
    expect(target.querySelector('.seats')?.textContent.trim()).toBe('12 of 10 places used')
    expect(field()?.disabled).toBe(true)
    expect(says('ada@example.com')).toBe(true)
    expect(says('bob@example.com')).toBe(true)
  })
  test('are not shown where nobody counted them, and the field stays open', () => {
    draw()
    expect(target.querySelector('.seats')).toBeNull()
    expect(field()?.disabled).toBe(false)
    expect(send()?.disabled).toBe(false)
    expect(says('This space is full')).toBe(false)
  })
  test('are not shown on the sheet about one file', () => {
    store.item = { id: 'note-1', path: 'Notes/plan.md' }
    draw()
    expect(target.querySelector('.seats')).toBeNull()
    expect(field()?.disabled).toBe(false)
  })
})
describe('the link', () => {
  test('starts without asking first', () => {
    draw()
    switchOf('Link')?.click()
    expect(store.setLink).toHaveBeenCalledOnce()
    expect(store.setLink).toHaveBeenCalledWith('read', 'open')
  })
  test('that lets anybody in says Ask first is off', () => {
    shown({ link: link('open') })
    draw()
    expect(switchOf('Ask first')?.getAttribute('aria-checked')).toBe('false')
  })
  test('that already asked first keeps saying so', () => {
    shown({ link: link('approval') })
    draw()
    expect(switchOf('Ask first')?.getAttribute('aria-checked')).toBe('true')
  })
  test('has no dot after its name', () => {
    shown({ link: link('open') })
    draw()
    expect(target.querySelector('.card-head .dot')).toBeNull()
    expect(target.querySelector('.card-head')?.children).toHaveLength(2)
  })
})
