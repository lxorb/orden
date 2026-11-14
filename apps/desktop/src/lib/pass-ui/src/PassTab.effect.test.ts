import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import type { Content } from '@orden/pass/types'
import { flushSync, mount, unmount } from 'svelte'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const { configurePass, pass } = await import('../../pass-sync/src/store.svelte')
const PassTab = (await import('./PassTab.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

const PASSWORD = 'correct horse battery staple'
const SECRET = 'Tr0ub4dor&3-hidden'

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

async function until(ready: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    flushSync()
    if (ready()) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error(`never: ${what}`)
}

function typed(field: HTMLInputElement | null, value: string) {
  if (!field) throw new Error('no field')
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function submitted(form: HTMLFormElement | null) {
  form?.dispatchEvent(new Event('submit', { cancelable: true }))
  flushSync()
}

function login(title: string, more: Partial<Content> = {}): Content {
  return { ...blank('login'), title, ...more } as Content
}

beforeAll(() => {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(PassTab, { target, props: { tab: null, focused: true }, intro: false })
  flushSync()
})

afterAll(() => {
  if (shown) void unmount(shown)
  target.remove()
})

describe('the Pass tab', () => {
  test('sets up with a password, shows the recovery key once, then the three columns', async () => {
    await until(() => pass.state === 'new', 'the setup screen')
    const fields = target.querySelectorAll<HTMLInputElement>('input[type=password]')
    typed(fields[0] ?? null, PASSWORD)
    typed(fields[1] ?? null, PASSWORD)
    submitted(target.querySelector('form'))
    await until(() => target.querySelector('.code') !== null, 'the recovery key')
    const code = target.querySelector('.code')?.textContent ?? ''
    expect(code.replace(/\W/g, '').length).toBeGreaterThan(20)
    expect(pass.state).toBe('open')
    pass.lock()
    await until(() => target.textContent.includes('Pass is locked'), 'the lock over the key')
    expect(target.querySelector('.code')).toBeNull()
    expect(await pass.unlock({ password: PASSWORD })).toBe(true)
    await until(() => target.querySelector('.list') !== null, 'the list')
    expect(target.querySelector('.code')).toBeNull()
    expect(target.querySelector('section[aria-label="All items"]')).not.toBeNull()
    expect(pass.vaults.map((one) => one.name)).toEqual(['Personal'])
  })

  test('filters by kind and by what is typed', async () => {
    const vault = pass.vaults[0]?.id ?? ''
    await pass.create(vault, login('Bank', { username: 'ada' }))
    await pass.create(vault, login('Mail', { username: 'lovelace' }))
    await pass.create(vault, { ...blank('note'), title: 'Diary', note: 'first line' })
    await until(() => target.querySelectorAll('[data-item]').length === 3, 'three rows')

    const search = target.querySelector<HTMLInputElement>('input[type=search]')
    typed(search, 'love')
    await until(() => target.querySelectorAll('[data-item]').length === 1, 'one row found')
    expect(target.querySelector('[data-item]')?.textContent).toContain('Mail')
    typed(search, '')

    const { menu } = await import('../../menu.svelte')
    const chosen = (label: string) => {
      target.querySelector<HTMLButtonElement>('.bar .orden-chip')?.click()
      flushSync()
      const row = menu.items.find((one) => one !== null && one.label === label)
      if (!row) throw new Error(`no ${label} in the menu`)
      row.run()
      menu.hide()
    }
    chosen('Notes')
    await until(() => target.querySelectorAll('[data-item]').length === 1, 'only the note')
    expect(target.querySelector('[data-item]')?.textContent).toContain('Diary')
    chosen('All')
    await until(() => target.querySelectorAll('[data-item]').length === 3, 'all rows again')
  })

  test('shows an item with its password hidden, and copies through Pass', async () => {
    const vault = pass.vaults[0]?.id ?? ''
    const made = await pass.create(vault, login('Shop', { username: 'grace', password: SECRET }))
    const copied = vi.spyOn(pass, 'copy').mockResolvedValue()
    await until(() => target.querySelector(`[data-item="${made.id}"]`) !== null, 'the row')
    target.querySelector<HTMLButtonElement>(`[data-item="${made.id}"]`)?.click()
    await until(() => target.querySelector('[data-field="Password"]') !== null, 'the item')
    const field = target.querySelector('[data-field="Password"]')
    expect(target.textContent).not.toContain(SECRET)
    field?.querySelector<HTMLButtonElement>('.tap')?.click()
    await until(() => copied.mock.calls.length > 0, 'the copy')
    expect(copied).toHaveBeenCalledWith(SECRET)
    field?.querySelector<HTMLButtonElement>('[aria-pressed]')?.click()
    flushSync()
    expect(field?.textContent).toContain(SECRET)
    copied.mockRestore()
  })

  test('locks, refuses a wrong password and opens for the right one', async () => {
    pass.lock()
    await until(() => target.textContent.includes('Pass is locked'), 'the lock')
    expect(target.textContent).not.toContain('Shop')
    const field = target.querySelector<HTMLInputElement>('input[type=password]')
    typed(field, 'not it')
    submitted(target.querySelector('form'))
    await until(() => target.querySelector('[role=alert]') !== null, 'the wrong password said')
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Wrong password')
    expect(pass.state).toBe('locked')
    typed(target.querySelector<HTMLInputElement>('input[type=password]'), PASSWORD)
    submitted(target.querySelector('form'))
    await until(() => pass.state === 'open', 'open again')
    await until(() => target.querySelector('.columns') !== null, 'the columns again')
  })
})
