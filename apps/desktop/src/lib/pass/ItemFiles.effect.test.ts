import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import type { Item, Passkey } from '@orden/pass/types'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  confirm: vi.fn(),
  delivered: [] as { name: string; extension: string; bytes: Uint8Array }[],
}))

vi.mock('../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../protect/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

vi.mock('../ui-kit/src/prompt.svelte', () => ({
  prompt: { confirm: fake.confirm, choose: vi.fn(), ask: vi.fn() },
}))

vi.mock('../export/save', () => ({
  deliver: (name: string, extension: string, _label: string, payload: { bytes: Uint8Array }) => {
    fake.delivered.push({ name, extension, bytes: payload.bytes })
    return Promise.resolve(name)
  },
}))

const { configurePass, pass } = await import('./store.svelte')
const { PassUi } = await import('./ui.svelte')
const ItemView = (await import('./ItemView.svelte')).default
const ItemEdit = (await import('./ItemEdit.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined
let vault = ''

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup('correct horse battery staple')
  pass.fileSource = () => Promise.resolve(null)
  vault = pass.vaults[0]?.id ?? ''
})

beforeEach(() => {
  fake.confirm.mockReset()
  fake.confirm.mockResolvedValue(true)
  fake.delivered.length = 0
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
})

function viewing(item: Item) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(ItemView, { target, props: { ui: new PassUi(null), item }, intro: false })
  flushSync()
}

function editing(ui: InstanceType<typeof PassUi>) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(ItemEdit, { target, props: { ui }, intro: false })
  flushSync()
}

function press(label: string) {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`no button ${label}`)
  button.click()
  flushSync()
}

function current(id: string): Item {
  const item = pass.items.find((one) => one.id === id)
  if (!item) throw new Error('gone')
  return item
}

describe('the files of an item', () => {
  test('are listed with their size, saved by Download and taken off by Remove', async () => {
    const made = await pass.create(vault, { ...blank('note'), title: 'Passport' })
    const item = await pass.attach(made.id, {
      name: 'passport.pdf',
      type: 'application/pdf',
      bytes: new Uint8Array(2048).fill(1),
    })
    viewing(item)
    const row = target.querySelector('[data-file="passport.pdf"]')
    expect(row?.textContent).toContain('2.0 KB')
    press('Download passport.pdf')
    await vi.waitFor(() => expect(fake.delivered).toHaveLength(1))
    expect(fake.delivered[0]).toMatchObject({ name: 'passport', extension: 'pdf' })
    expect(fake.delivered[0]?.bytes.length).toBe(2048)

    press('Remove passport.pdf')
    await vi.waitFor(() => expect(current(made.id).attachments).toEqual([]))
    expect(fake.confirm).toHaveBeenCalledOnce()
  })

  test('are attached while editing and kept on save', async () => {
    const made = await pass.create(vault, { ...blank('note'), title: 'Lease' })
    const ui = new PassUi(null)
    await ui.edit(made.id)
    editing(ui)
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('no picker')
    const file = new File([new Uint8Array([1, 2, 3])], 'lease.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(target.textContent).toContain('lease.txt'))
    expect(ui.dirty).toBe(true)
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(ui.editing).toBeNull())
    const [attachment] = current(made.id).attachments
    expect(attachment).toMatchObject({ name: 'lease.txt', type: 'text/plain', size: 3 })
    expect(await pass.fileBytes(made.id, attachment?.id ?? '')).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('are attached to a new item once it is made', async () => {
    const ui = new PassUi(null)
    await ui.newItem({ ...blank('note'), title: 'Will' })
    editing(ui)
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('no picker')
    const file = new File(['hello'], 'will.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(target.textContent).toContain('will.txt'))
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(ui.editing).toBeNull())
    const will = pass.items.find((one) => one.content.title === 'Will')
    expect(will?.attachments.map((one) => one.name)).toEqual(['will.txt'])
  })
})

describe('the passkeys of a login', () => {
  const passkey: Passkey = {
    id: 'pk1',
    rpId: 'github.com',
    rpName: 'GitHub',
    userName: 'ada',
    userDisplayName: 'Ada',
    userHandle: 'aGFuZGxl',
    credentialId: 'Y3JlZA',
    privateKey: 'cHJpdg',
    algorithm: -7,
    counter: 0,
    created: Date.UTC(2026, 0, 2),
    note: '',
  }

  test('are shown with their site and user, and can be removed', async () => {
    const made = await pass.create(vault, {
      ...blank('login'),
      title: 'GitHub',
      passkeys: [passkey],
    })
    viewing(made)
    const row = target.querySelector('[data-passkey="github.com"]')
    expect(row?.textContent).toContain('ada')
    expect(row?.textContent).toContain('GitHub')
    expect(row?.textContent).toContain('2026')
    press('Remove the passkey for github.com')
    await vi.waitFor(() => {
      const after = current(made.id).content
      expect(after.kind === 'login' && after.passkeys).toEqual([])
    })
  })

  test('cannot be removed in the trash', async () => {
    const made = await pass.create(vault, { ...blank('login'), title: 'Old', passkeys: [passkey] })
    await pass.trash([made.id])
    viewing(current(made.id))
    expect(target.querySelector('[data-passkey="github.com"]')).not.toBeNull()
    expect(
      target.querySelector('button[aria-label="Remove the passkey for github.com"]'),
    ).toBeNull()
  })
})

describe('an SSH key', () => {
  test('is made by Generate key and shows its fingerprint', async () => {
    const ui = new PassUi(null)
    await ui.newItem({ ...blank('ssh'), title: 'Server' })
    editing(ui)
    const generate = await vi.waitFor(() => {
      const button = [...target.querySelectorAll('button')].find(
        (one) => one.textContent.trim() === 'Generate key',
      )
      if (!button) throw new Error('no generate')
      return button
    })
    generate.click()
    await vi.waitFor(() => {
      const areas = [...target.querySelectorAll('textarea')].map((one) => one.value)
      expect(areas.some((one) => one.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'))).toBe(true)
      expect(areas.some((one) => one.startsWith('ssh-ed25519 AAAA'))).toBe(true)
    })
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(ui.editing).toBeNull())
    const key = pass.items.find((one) => one.content.title === 'Server')
    if (key?.content.kind !== 'ssh') throw new Error('no key')
    expect(key.content.publicKey).toMatch(/^ssh-ed25519 \S+ Server$/)

    if (shown) void unmount(shown)
    target.remove()
    viewing(key)
    await vi.waitFor(() =>
      expect(target.querySelector('[data-field="Fingerprint"]')?.textContent).toMatch(/SHA256:/),
    )
  })
})
