import type { VaultMeta } from '@orden/pass/types'
import type { Invite } from '@orden/pass/wire'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  pass: {
    vaults: [],
    items: [],
    inviteMeta: vi.fn(),
    inviterCode: vi.fn(),
    acceptInvite: vi.fn(),
    declineInvite: vi.fn(),
  },
  passSync: { invites: [] as Invite[], refresh: vi.fn() },
}))

vi.mock('../../pass-sync/src/store.svelte', () => ({ pass: fake.pass }))
vi.mock('../../pass-sync/src/syncing.svelte', () => ({ passSync: fake.passSync }))

const InvitesList = (await import('./InvitesList.svelte')).default

const META: VaultMeta = {
  v: 1,
  name: 'Family',
  description: '',
  color: 'teal',
  icon: 'family',
  folders: [],
  hidePasswordsFromViewers: false,
}

const invite = (vault: string, more: Partial<Invite> = {}): Invite => ({
  vault,
  from: 'ada@example.com',
  fromName: 'Ada',
  role: 'editor',
  key: 'sealed-key',
  meta: 'sealed-meta',
  keyVersion: 1,
  fromKey: null,
  proof: null,
  pin: null,
  ...more,
})

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  for (const one of [
    fake.pass.inviteMeta,
    fake.pass.inviterCode,
    fake.pass.acceptInvite,
    fake.pass.declineInvite,
    fake.passSync.refresh,
  ])
    one.mockReset()
  fake.pass.inviteMeta.mockImplementation((one: Invite) =>
    Promise.resolve(one.key === null ? null : META),
  )
  fake.pass.inviterCode.mockResolvedValue('1a2b 3c4d')
  fake.passSync.refresh.mockResolvedValue(undefined)
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function shown(invites: Invite[]) {
  fake.passSync.invites = invites
  const drawn = mount(InvitesList, { target, intro: false })
  close = () => void unmount(drawn)
  flushSync()
}

function row(vault: string): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-invite="${vault}"]`)
  if (!found) throw new Error(`no invite ${vault}`)
  return found
}

function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

describe('invitations to a vault', () => {
  test('show nothing when there are none', () => {
    shown([])
    expect(target.textContent.trim()).toBe('')
  })

  test('name the sender, the vault and the role', async () => {
    shown([invite('v1')])
    await vi.waitFor(() => expect(row('v1').textContent).toContain('Family'))
    expect(row('v1').textContent).toContain('Ada (ada@example.com) invited you: Can edit')
    expect(fake.pass.inviteMeta).toHaveBeenCalledWith(fake.passSync.invites[0])
    await vi.waitFor(() => expect(row('v1').textContent).toContain('Their safety code: 1a2b 3c4d'))
  })

  test('are accepted, and the vault is read again', async () => {
    fake.pass.acceptInvite.mockResolvedValue(undefined)
    shown([invite('v1'), invite('v2', { role: 'viewer' })])
    await vi.waitFor(() => expect(row('v1').textContent).toContain('Family'))
    button(row('v1'), 'Accept').click()
    await vi.waitFor(() =>
      expect(fake.pass.acceptInvite).toHaveBeenCalledWith(expect.objectContaining({ vault: 'v1' })),
    )
    await vi.waitFor(() => expect(fake.passSync.refresh).toHaveBeenCalledOnce())
    expect(fake.passSync.invites.map((one) => one.vault)).toEqual(['v2'])
    expect(fake.pass.declineInvite).not.toHaveBeenCalled()
  })

  test('are declined', async () => {
    fake.pass.declineInvite.mockResolvedValue(undefined)
    shown([invite('v1')])
    button(row('v1'), 'Decline').click()
    await vi.waitFor(() => expect(fake.pass.declineInvite).toHaveBeenCalledWith('v1'))
    expect(fake.pass.acceptInvite).not.toHaveBeenCalled()
  })

  test('wait to be confirmed before they can be accepted when they carry no key', async () => {
    shown([invite('v1', { key: null, fromName: '' })])
    await vi.waitFor(() => expect(fake.pass.inviteMeta).toHaveBeenCalled())
    const one = row('v1')
    expect(one.textContent).toContain('A shared vault')
    expect(one.textContent).toContain('ada@example.com invited you: Can edit')
    expect(one.textContent).toContain('Waiting for them to confirm you')
    expect(button(one, 'Accept').disabled).toBe(true)
    expect(button(one, 'Decline').disabled).toBe(false)
  })

  test('say what went wrong', async () => {
    fake.pass.acceptInvite.mockRejectedValue(new Error('pass: no such invitation'))
    shown([invite('v1')])
    button(row('v1'), 'Accept').click()
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain('no such invitation'),
    )
  })
})
