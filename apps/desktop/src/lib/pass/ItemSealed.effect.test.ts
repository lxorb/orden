import 'fake-indexeddb/auto'
import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Content, Item, Vault } from '@orden/pass/types'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

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

const { configurePass, pass } = await import('./store.svelte')
const { PassUi } = await import('./ui.svelte')
const { menu } = await import('../menu.svelte')
const ItemView = (await import('./ItemView.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

const SECRET = 'wifi-pass-hidden-1'
const TOTP = 'JBSWY3DPEHPK3PXP'

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

function vaultHeldAs(id: string, role: Vault['role'], hide: boolean): Vault {
  return {
    v: 1,
    id,
    rev: 1,
    role,
    members: 2,
    shared: true,
    name: id,
    description: '',
    color: 'blue',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers: hide,
  }
}

function itemIn(vault: string, content: Content): Item {
  return { ...newEnvelope(content, 1), id: `${vault}-${content.kind}`, vault, rev: 1 }
}

function viewing(item: Item) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(ItemView, { target, props: { ui: new PassUi(null), item }, intro: false })
  flushSync()
}

function menuLabels(): string[] {
  target.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click()
  flushSync()
  const labels = menu.items.flatMap((one) => (one === null ? [] : [one.label]))
  menu.hide()
  return labels
}

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup('correct horse battery staple')
  pass.vaults = [
    ...pass.vaults,
    vaultHeldAs('hidden', 'viewer', true),
    vaultHeldAs('open', 'viewer', false),
  ]
})

function closed() {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
}

afterEach(closed)

const wifi = (): Content => ({ ...blank('wifi'), title: 'Home', ssid: 'Home', password: SECRET })
const login = (): Content => ({ ...blank('login'), title: 'Bank', totp: TOTP })

describe('an item in a vault that hides passwords from its viewers', () => {
  test('shows a viewer no 2FA code, no WiFi QR code, and no Duplicate or History', () => {
    viewing(itemIn('hidden', login()))
    expect(target.querySelector('.totp')).toBeNull()
    expect(target.querySelector('[data-field="2FA code"][data-sealed]')).not.toBeNull()
    const labels = menuLabels()
    expect(labels).toContain('Move to trash')
    expect(labels).not.toContain('Duplicate')
    expect(labels).not.toContain('History')
    closed()

    viewing(itemIn('hidden', wifi()))
    expect(target.textContent).not.toContain('Show QR code')
    expect(target.textContent).not.toContain(SECRET)
  })

  test('shows them all where the vault does not hide them', () => {
    viewing(itemIn('open', login()))
    expect(target.querySelector('.totp')).not.toBeNull()
    expect(menuLabels()).toEqual(expect.arrayContaining(['Duplicate', 'History']))
    closed()

    viewing(itemIn('open', wifi()))
    expect(target.textContent).toContain('Show QR code')
  })
})
