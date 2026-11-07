import { describe, expect, test } from 'vitest'
import { AccountInbox } from './account.svelte'
import type { ClosingDisk } from './disk'
import { type Kept, keptOver } from './store'

function disks() {
  const all = new Map<string, Map<string, Kept>>()
  const open = (owner: string | null): Promise<ClosingDisk> => {
    const name = owner ?? ''
    const kept = all.get(name) ?? new Map<string, Kept>()
    all.set(name, kept)
    let cursor = 0
    return Promise.resolve({
      items: () => Promise.resolve([...kept.values()]),
      put: (items) =>
        Promise.resolve(
          items.map((one) => {
            const merged = keptOver(kept.get(one.id), one)
            kept.set(one.id, merged)
            return merged
          }),
        ),
      cursor: () => Promise.resolve(cursor),
      keepCursor: (at) => {
        cursor = at
        return Promise.resolve()
      },
      clear: () => {
        kept.clear()
        return Promise.resolve()
      },
      close: () => undefined,
    })
  }
  return { all, open }
}

describe('the account inbox on a device', () => {
  test('waits for the account before it answers, and carries what was written signed out', async () => {
    const { all, open } = disks()
    const inbox = new AccountInbox(open)
    const early = inbox.text()
    await inbox.opened({ owner: null, server: null, device: 'laptop' })
    expect(await early).toBe('')
    await inbox.write('- [ ] Written signed out\n')
    await inbox.opened({ owner: 'me', server: null, device: 'laptop' })
    expect(await inbox.text()).toMatch(/Written signed out/)
    expect(all.get('')?.size).toBe(0)
    expect(all.get('me')?.size).toBe(1)
  })

  test('counts what is kept on the device as kept only when nobody is signed in', async () => {
    const { open } = disks()
    const inbox = new AccountInbox(open)
    await inbox.opened({ owner: null, server: null, device: 'laptop' })
    await inbox.carried([{ id: 'm1', fields: { text: 'Old', status: ' ' } }])
    expect(await inbox.kept(['m1'])).toBe(true)
    expect(await inbox.kept(['m2'])).toBe(false)
    await inbox.opened({ owner: 'me', server: null, device: 'laptop' })
    expect(await inbox.kept(['m1'])).toBe(false)
  })
})
