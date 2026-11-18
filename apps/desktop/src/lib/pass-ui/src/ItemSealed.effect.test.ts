import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Content, Item, Vault } from '@orden/pass/types'
import { flushSync } from 'svelte'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { closed, showing, target } from '../test/drawn'
import { opened, pass } from '../test/opened'

const { PassUi } = await import('../../pass-sync/src/ui.svelte')
const { menu } = await import('../../ui-kit/src/api')
const ItemView = (await import('./ItemView.svelte')).default

const SECRET = 'wifi-pass-hidden-1'
const TOTP = 'JBSWY3DPEHPK3PXP'

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

const viewing = (item: Item) => showing(ItemView, { ui: new PassUi(null), item })

function menuLabels(): string[] {
  target.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click()
  flushSync()
  const labels = menu.items.flatMap((one) => (one === null ? [] : [one.label]))
  menu.hide()
  return labels
}

beforeAll(async () => {
  await opened()
  pass.vaults = [
    ...pass.vaults,
    vaultHeldAs('hidden', 'viewer', true),
    vaultHeldAs('open', 'viewer', false),
  ]
})

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
