import type { Role, Vault } from '@orden/pass/types'
import type { Member } from '@orden/pass/wire'
import type { Person } from './people'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface Signed {
  user: { id: string; email: string; name: string } | null
  token: string | null
}

const fake = vi.hoisted(() => {
  const account: Signed = {
    user: { id: 'ada', email: 'ada@example.com', name: 'Ada' },
    token: 'token',
  }
  return {
    pass: {
      vaults: [] as Vault[],
      items: [],
      members: vi.fn(),
      invite: vi.fn(),
      confirmMember: vi.fn(),
      setRole: vi.fn(),
      removeMember: vi.fn(),
      leave: vi.fn(),
      transfer: vi.fn(),
      person: vi.fn(),
      memberPerson: vi.fn(),
      codesMatch: vi.fn(),
      updateVault: vi.fn(),
    },
    account,
    prompt: { confirm: vi.fn(), choose: vi.fn(), ask: vi.fn() },
  }
})

vi.mock('./store.svelte', () => ({ pass: fake.pass }))
vi.mock('../account.svelte', () => ({ account: fake.account }))
vi.mock('../prompt.svelte', () => ({ prompt: fake.prompt }))

const { PassUi } = await import('./ui.svelte')
const ShareSheet = (await import('./ShareSheet.svelte')).default
const FieldRow = (await import('./FieldRow.svelte')).default

const CODE = '1a2b 3c4d 5e6f 7a8b 9c0d 1e2f 3a4b 5c6d'

function vaultAs(role: Role, hidePasswordsFromViewers = false): Vault {
  return {
    v: 1,
    id: 'v1',
    name: 'Family',
    description: '',
    color: 'purple',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers,
    rev: 1,
    role,
    members: 4,
    shared: true,
  }
}

const MEMBERS: Member[] = [
  { email: 'ada@example.com', name: 'Ada', role: 'owner', state: 'active', pub: 'P1' },
  { email: 'bob@example.com', name: 'Bob', role: 'editor', state: 'active', pub: 'P2' },
  { email: 'cy@example.com', name: '', role: 'viewer', state: 'confirm', pub: 'P3' },
  { email: 'dee@example.com', name: '', role: 'viewer', state: 'pending', pub: null },
].map((one) => ({ ...one, signPub: null, vouch: null }) as Member)

const personAt = (email: string, known: Person['known'] = 'seen'): Person => ({
  email,
  key: { pub: 'P', signPub: 'S' },
  code: CODE,
  known,
})

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  for (const one of Object.values(fake.pass)) {
    if (typeof one === 'function') one.mockReset()
  }
  fake.pass.members.mockResolvedValue(MEMBERS)
  fake.pass.person.mockImplementation((email: string) =>
    Promise.resolve(personAt(email.toLowerCase())),
  )
  fake.pass.memberPerson.mockImplementation((one: Member) => Promise.resolve(personAt(one.email)))
  fake.pass.codesMatch.mockImplementation((one: Person) =>
    Promise.resolve({ ...one, known: 'confirmed' }),
  )
  fake.pass.vaults = [vaultAs('owner')]
  fake.account.user = { id: 'ada', email: 'ada@example.com', name: 'Ada' }
  fake.prompt.confirm.mockResolvedValue(true)
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

async function shown() {
  const ui = new PassUi(null)
  ui.sheet = { kind: 'share', vault: 'v1' }
  const drawn = mount(ShareSheet, { target, props: { ui }, intro: false })
  close = () => void unmount(drawn)
  flushSync()
  await vi.waitFor(() => {
    if (fake.account.user && !target.querySelector('[data-member]')) throw new Error('no members')
  })
  return ui
}

function button(name: string, within: ParentNode = target): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name || one.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

function member(email: string): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-member="${email}"]`)
  if (!found) throw new Error(`no ${email}`)
  return found
}

function typed(field: HTMLInputElement, text: string) {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

describe('sharing a vault', () => {
  test('asks to sign in first, and asks the account nothing', async () => {
    fake.account.user = null
    await shown()
    expect(target.querySelector('[data-signed-out]')?.textContent).toContain('Sign in to share')
    expect(fake.pass.members).not.toHaveBeenCalled()
    expect(target.querySelector('input[type="email"]')).toBe(null)
  })

  test('lists the members with their state, and confirms the one waiting', async () => {
    await shown()
    expect(fake.pass.members).toHaveBeenCalledWith('v1')
    expect(member('bob@example.com').textContent).toContain('Active')
    expect(member('dee@example.com').textContent).toContain('Pending')
    const waiting = member('cy@example.com')
    expect(waiting.textContent).toContain('Waiting for you to confirm')
    expect(() => button('Confirm', member('bob@example.com'))).toThrow()

    button('Confirm', waiting).click()
    await vi.waitFor(() => expect(waiting.textContent).toContain(CODE))
    expect(fake.pass.confirmMember).not.toHaveBeenCalled()
    button('Codes match', waiting).click()
    await vi.waitFor(() =>
      expect(fake.pass.confirmMember).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ email: 'cy@example.com', known: 'confirmed' }),
      ),
    )
    await vi.waitFor(() => expect(fake.pass.members).toHaveBeenCalledTimes(2))
  })

  test('warns when somebody’s key is not the one this device knew', async () => {
    fake.pass.person.mockResolvedValue(personAt('eve@example.com', 'changed'))
    await shown()
    typed(target.querySelector<HTMLInputElement>('input[type="email"]')!, 'eve@example.com')
    await vi.waitFor(() => expect(target.querySelector('[data-changed]')).not.toBe(null))
  })

  test('shows the safety code of the address typed, then invites with the role chosen', async () => {
    fake.pass.invite.mockResolvedValue('pending')
    await shown()
    const email = target.querySelector<HTMLInputElement>('input[type="email"]')!
    expect(button('Invite').disabled).toBe(true)
    typed(email, 'Eve@Example.com')
    await vi.waitFor(() =>
      expect(target.querySelector('[data-safety]')?.textContent).toContain(CODE),
    )
    expect(fake.pass.person).toHaveBeenCalledWith('Eve@Example.com')
    button('Codes match').click()
    await vi.waitFor(() => expect(target.querySelector('[data-matched]')).not.toBe(null))

    button('Role').click()
    flushSync()
    const editor = [...document.querySelectorAll('[role="option"]')].find(
      (one) => one.textContent.trim() === 'Can edit',
    ) as HTMLElement
    editor.click()
    flushSync()

    button('Invite').click()
    await vi.waitFor(() =>
      expect(fake.pass.invite).toHaveBeenCalledWith(
        'v1',
        { ...personAt('eve@example.com'), known: 'confirmed' },
        'editor',
      ),
    )
    await vi.waitFor(() => expect(email.value).toBe(''))
  })

  test('says when the person has no Pass yet', async () => {
    fake.pass.person.mockResolvedValue({
      email: 'new@example.com',
      key: null,
      code: null,
      known: 'new',
    })
    await shown()
    typed(target.querySelector<HTMLInputElement>('input[type="email"]')!, 'new@example.com')
    await vi.waitFor(() =>
      expect(target.querySelector('[data-safety]')?.textContent).toContain('not set up Pass'),
    )
  })

  test('shows a member’s safety code to read aloud', async () => {
    await shown()
    button('Safety code', member('bob@example.com')).click()
    await vi.waitFor(() => expect(member('bob@example.com').textContent).toContain(CODE))
    expect(fake.pass.memberPerson).toHaveBeenCalledWith(MEMBERS[1])
  })

  test('changes a role and removes somebody once asked', async () => {
    await shown()
    button('Role of Bob').click()
    flushSync()
    const viewer = [...document.querySelectorAll('[role="option"]')].find(
      (one) => one.textContent.trim() === 'Can view',
    ) as HTMLElement
    viewer.click()
    await vi.waitFor(() =>
      expect(fake.pass.setRole).toHaveBeenCalledWith('v1', 'bob@example.com', 'viewer'),
    )

    await vi.waitFor(() => expect(button('Remove Bob').disabled).toBe(false))
    button('Remove Bob').click()
    await vi.waitFor(() =>
      expect(fake.pass.removeMember).toHaveBeenCalledWith('v1', 'bob@example.com'),
    )
    expect(fake.prompt.confirm).toHaveBeenCalledOnce()
    expect(() => button('Remove Ada')).toThrow()
  })

  test('hides passwords from viewers and hands the vault on, for its owner', async () => {
    fake.prompt.choose.mockResolvedValue('bob@example.com')
    await shown()
    const hide = target.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(hide.getAttribute('aria-checked')).toBe('false')
    hide.click()
    await vi.waitFor(() =>
      expect(fake.pass.updateVault).toHaveBeenCalledWith('v1', { hidePasswordsFromViewers: true }),
    )

    expect(() => button('Leave vault')).toThrow()
    await vi.waitFor(() => expect(button('Transfer ownership').disabled).toBe(false))
    button('Transfer ownership').click()
    await vi.waitFor(() => expect(fake.pass.transfer).toHaveBeenCalledWith('v1', 'bob@example.com'))
    const offered = fake.prompt.choose.mock.calls[0]?.[0] as { options: { id: string }[] }
    expect(offered.options.map((one) => one.id)).toEqual(['bob@example.com'])
  })

  test('to a viewer, shows the members only, and lets them leave', async () => {
    fake.pass.vaults = [vaultAs('viewer', true)]
    fake.account.user = { id: 'cy', email: 'cy@example.com', name: '' }
    const ui = await shown()
    expect(target.querySelector('input[type="email"]')).toBe(null)
    expect(target.querySelector('[role="switch"]')).toBe(null)
    expect(target.querySelector('[role="combobox"]')).toBe(null)
    expect(() => button('Remove Bob')).toThrow()
    expect(() => button('Confirm')).toThrow()
    expect(() => button('Transfer ownership')).toThrow()
    expect(target.textContent).toContain('Passwords in this vault are hidden from you.')

    button('Leave vault').click()
    await vi.waitFor(() => expect(fake.pass.leave).toHaveBeenCalledWith('v1'))
    await vi.waitFor(() => expect(ui.sheet).toBe(null))
  })
})

describe('a hidden field in a vault that hides passwords from viewers', () => {
  test('shows neither Show nor Copy, nor the value', () => {
    const drawn = mount(FieldRow, {
      target,
      props: { label: 'Password', value: 'hunter2', hidden: true, sealed: true },
    })
    close = () => void unmount(drawn)
    flushSync()
    expect(target.textContent).not.toContain('hunter2')
    expect(target.querySelectorAll('button')).toHaveLength(0)
  })
})
