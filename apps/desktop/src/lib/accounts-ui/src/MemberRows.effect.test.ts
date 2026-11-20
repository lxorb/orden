import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../sharing/src/api', () => ({
  whoIs: (person: { guest?: string | null; email?: string | null }) => `person:${person.guest ?? person.email ?? ''}`,
}))
const { account } = await import('../../accounts/src/api')
const MemberRows = (await import('./MemberRows.svelte')).default
const someone = (email: string, more: object = {}) => ({
  email,
  guest: null,
  name: null,
  role: 'write',
  pending: false,
  ...more,
})
function storeWith(item: { id: string; path: string } | null = null) {
  return {
    who: {
      owner: { email: 'emil@example.com', name: 'Emil', id: 'u1' },
      item: null,
      members: [
        someone('ada@example.com', { admin: true }),
        someone('bob@example.com'),
        someone('cy@example.com', { role: 'read' }),
        { email: null, guest: 'g1', name: 'Windows wren', role: 'write', pending: false },
        someone('dee@example.com', { pending: true }),
      ],
      requests: [],
      link: null,
    },
    item,
    spaceId: 'space-1',
    busy: false,
    waiting: () => false,
    setRole: vi.fn(),
    remove: vi.fn(),
    resend: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
  }
}
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(() => {
  account.user = null
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})
function draw(props: { store: ReturnType<typeof storeWith>; manages: boolean; titled?: boolean }) {
  const shown = mount(MemberRows, { target, props: props as never, intro: false })
  close = () => void unmount(shown)
  flushSync()
}
const rows = () => [...target.querySelectorAll<HTMLElement>('.row.person')]
const rowOf = (words: string) => {
  const found = rows().find((one) => one.textContent.includes(words))
  if (!found) throw new Error(`no row for ${words}`)
  return found
}
const picker = (words: string) => rowOf(words).querySelector<HTMLButtonElement>('button[role="combobox"]')
function opened(words: string): HTMLElement[] {
  picker(words)?.click()
  flushSync()
  const list = picker(words)?.getAttribute('aria-controls')
  return list ? [...document.querySelectorAll<HTMLElement>(`[id="${list}"] [role="option"]`)] : []
}
function choices(words: string): string[] {
  const listed = opened(words).map((one) => one.textContent.trim())
  picker(words)?.click()
  flushSync()
  return listed
}
describe('the people in a space', () => {
  test('are the owner, fixed, then everybody else at their role', () => {
    draw({ store: storeWith(), manages: true })
    expect(rowOf('Emil').querySelector('.fixed')?.textContent).toBe('Owner')
    expect(rowOf('Emil').querySelector('button[role="combobox"]')).toBeNull()
    expect(picker('ada')?.textContent.trim()).toBe('Admin')
    expect(picker('bob')?.textContent.trim()).toBe('Write')
    expect(picker('cy')?.textContent.trim()).toBe('View')
    expect(picker('Windows wren')?.textContent.trim()).toBe('Write')
    expect(rowOf('dee').textContent).toContain('Invited')
    expect(rowOf('Windows wren').textContent).toContain('Guest')
  })
  test('call the owner you only when it is you', () => {
    draw({ store: storeWith(), manages: true })
    expect(rowOf('Emil').textContent).not.toContain('(you)')
    close?.()
    account.user = { id: 'u1', email: 'emil@example.com', name: 'Emil' }
    draw({ store: storeWith(), manages: true })
    expect(rowOf('Emil').textContent).toContain('(you)')
  })
  test('may be made admins by whoever manages the space, all but a guest', () => {
    draw({ store: storeWith(), manages: true })
    expect(picker('bob')?.disabled).toBe(false)
    expect(choices('bob')).toEqual(['Write', 'View', 'Admin', 'Remove'])
    expect(choices('Windows wren')).toEqual(['Write', 'View', 'Remove'])
    expect(choices('dee')).toEqual(['Write', 'View', 'Admin', 'Resend', 'Remove'])
  })
  test('and making one asks the store for it', () => {
    const store = storeWith()
    draw({ store, manages: true })
    opened('bob')
      .find((one) => one.textContent.trim() === 'Admin')
      ?.click()
    flushSync()
    expect(store.setRole).toHaveBeenCalledWith(expect.objectContaining({ email: 'bob@example.com' }), 'admin')
  })
  test('offer no admin on the sheet about one file', () => {
    draw({ store: storeWith({ id: 'note-1', path: 'Notes/plan.md' }), manages: true })
    expect(choices('bob')).toEqual(['Write', 'View', 'Remove'])
  })
  test('are only shown to somebody who writes or reads there', () => {
    draw({ store: storeWith(), manages: false })
    for (const one of ['ada', 'bob', 'cy', 'Windows wren', 'dee']) expect(picker(one)?.disabled).toBe(true)
  })
  test('carry their heading and the people waiting in the Share sheet, and are setting rows in Settings', () => {
    const asking = () => {
      const store = storeWith()
      Object.assign(store.who, { requests: [{ ...someone('eve@example.com'), at: 1 }] })
      return store
    }
    draw({ store: asking(), manages: true })
    expect([...target.querySelectorAll('h3')].map((one) => one.textContent)).toEqual(['Waiting', 'Who has access'])
    close?.()
    draw({ store: asking(), manages: true, titled: false })
    expect(target.querySelector('h3')).toBeNull()
    expect(target.textContent).not.toContain('eve@example.com')
    expect(rows()).toHaveLength(6)
    for (const one of rows()) expect([...one.classList]).toEqual(expect.arrayContaining(['orden-setting', 'setting']))
  })
})
