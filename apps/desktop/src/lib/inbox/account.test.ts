import { describe, expect, test, vi } from 'vitest'
import { mergedInbox, type InboxChange, type InboxItem } from '@orden/sync-core'
import { AccountInbox } from './account.svelte'
import type { ClosingDisk } from './disk'
import { type InboxServer, type Kept, keptOver } from './store'

function account(): InboxServer {
  const items = new Map<string, InboxItem>()
  let seq = 0
  return {
    push: (changes: readonly InboxChange[]) => {
      for (const change of changes) {
        const merged = mergedInbox(items.get(change.id) ?? null, change)
        if (merged.changed)
          items.set(change.id, { id: change.id, ...merged, seq: (seq += 1), at: 0 })
      }
      return Promise.resolve(true)
    },
    pull: (since: number) =>
      Promise.resolve({
        items: [...items.values()].filter((one) => one.seq > since),
        cursor: seq,
        more: false,
      }),
  }
}

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

  test('shows what one window fetched from the account in the other windows at once', async () => {
    const server = account()
    const phone = new AccountInbox(disks().open)
    await phone.opened({ owner: 'fetched', server, device: 'phone' })
    await phone.write('- [ ] From the phone\n')
    expect(await phone.exchange()).toBe(true)

    const { open } = disks()
    const front = new AccountInbox(open)
    const back = new AccountInbox(open)
    await back.opened({ owner: 'fetched', server: null, device: 'laptop' })
    await front.opened({ owner: 'fetched', server, device: 'laptop' })
    expect(await front.exchange()).toBe(true)
    expect(await front.text()).toMatch(/From the phone/)
    await vi.waitFor(async () => expect(await back.text()).toMatch(/From the phone/))
  })

  test('hears a window that wrote while it was still opening', async () => {
    const { open } = disks()
    const writer = new AccountInbox(open)
    await writer.opened({ owner: 'early', server: null, device: 'laptop' })
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => (release = done))
    let read = false
    const late = new AccountInbox(async (owner) => {
      const disk = await open(owner)
      return {
        ...disk,
        items: async () => {
          const got = await disk.items()
          read = true
          await held
          return got
        },
      }
    })
    const opening = late.opened({ owner: 'early', server: null, device: 'laptop' })
    await vi.waitFor(() => expect(read).toBe(true))
    await writer.write('- [ ] Written meanwhile\n')
    release()
    await opening
    await vi.waitFor(async () => expect(await late.text()).toMatch(/Written meanwhile/))
  })

  test('reaches no account but the one whose records are open while it switches', async () => {
    const { all, open } = disks()
    const mine = account()
    const theirs = account()
    await theirs.push([
      { id: 'b1', fields: { text: 'Theirs' }, stamps: { text: '00000000a-0000-x' } },
    ])
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => (release = done))
    const inbox = new AccountInbox(async (owner) => {
      if (owner === 'them') await held
      return open(owner)
    })
    await inbox.opened({ owner: 'me', server: mine, device: 'laptop' })
    await inbox.write('- [ ] Mine\n')

    const switching = inbox.opened({ owner: 'them', server: theirs, device: 'laptop' })
    await inbox.exchange()
    release()
    await switching

    expect(all.get('me')?.has('b1')).toBe(false)
    const reached = await theirs.pull(0)
    expect(reached?.items.map((one) => one.id)).toEqual(['b1'])
  })
})
