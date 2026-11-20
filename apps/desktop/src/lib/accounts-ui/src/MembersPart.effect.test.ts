import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({
  who: null as object | null,
  error: null as string | null,
  item: null,
  seats: null,
  spaceId: 'space-1',
  busy: false,
  manages: false,
  waiting: () => false,
  look: () => Promise.resolve(),
}))
vi.mock('../../sharing/src/api', () => ({
  members: store,
  managesSpace: () => store.manages,
  whoIs: (person: { guest?: string | null; email?: string | null }) => `person:${person.guest ?? person.email ?? ''}`,
}))
vi.mock('./shell-parts', () => ({ membersRoot: () => '/space' }))
const MembersPart = (await import('./MembersPart.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(() => {
  Object.assign(store, { who: null, error: null, manages: false })
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})
function draw() {
  const shown = mount(MembersPart, { target, intro: false })
  close = () => void unmount(shown)
  flushSync()
}
describe('the members of a space in Settings', () => {
  test('say plainly who may see them when the account turns a member away, and stop waiting', () => {
    store.error = 'only the owner can do that'
    draw()
    expect(target.textContent).toContain('Only the owner and admins can see who is in this space.')
    expect(target.textContent).not.toContain('only the owner can do that')
    expect(target.querySelector('.wrong')).toBeNull()
    expect(target.querySelector('.bone')).toBeNull()
  })
  test('say what went wrong to whoever manages the space, without waiting forever', () => {
    store.manages = true
    store.error = 'could not reach the server'
    draw()
    expect(target.querySelector('.wrong')?.textContent.trim()).toBe('could not reach the server')
    expect(target.querySelector('.bone')).toBeNull()
  })
  test('wait while they are on their way', () => {
    draw()
    expect(target.querySelector('.bone')).not.toBeNull()
  })
  test('are listed to a member who may only read, with their roles and no controls', () => {
    store.who = {
      owner: { email: 'emil@example.com', name: 'Emil' },
      item: null,
      members: [{ email: 'ada@example.com', guest: null, name: null, role: 'write', pending: false }],
      requests: [],
      link: null,
    }
    draw()
    expect(target.textContent).toContain('Owner')
    expect(target.textContent).toContain('ada@example.com')
    expect(target.querySelector<HTMLButtonElement>('button[role="combobox"]')?.disabled).toBe(true)
  })
})
