import { describe, expect, test } from 'vitest'
import {
  type InboxChange,
  inboxChangesOf,
  type InboxItem,
  mergedInbox,
} from '@orden/sync-core/inbox'
import { type InboxDisk, type InboxServer, InboxRecords, type Kept, keptOver } from './store'

function memoryDisk(kept = new Map<string, Kept>()): InboxDisk & { kept: Map<string, Kept> } {
  let cursor = 0
  return {
    kept,
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
  }
}

function account(): InboxServer & { up: boolean } {
  const items = new Map<string, InboxItem>()
  let seq = 0
  const server = {
    up: true,
    push: (changes: readonly InboxChange[]) => {
      if (!server.up) return Promise.resolve(false)
      for (const change of changes) {
        const merged = mergedInbox(items.get(change.id) ?? null, change)
        if (merged.changed) {
          items.set(change.id, { id: change.id, ...merged, seq: (seq += 1), at: 0 })
        }
      }
      return Promise.resolve(true)
    },
    pull: (since: number) => {
      if (!server.up) return Promise.resolve(null)
      const after = [...items.values()].filter((one) => one.seq > since)
      return Promise.resolve({ items: after, cursor: seq, more: false })
    },
  }
  return server
}

const device = (name: string, clock: { at: number }) =>
  new InboxRecords(
    memoryDisk(),
    name,
    () => clock.at,
    () => `${name}${(clock.at += 1)}`,
  )

describe('the inbox kept on a device', () => {
  test('meets the inbox on another device through the account, field by field', async () => {
    const clock = { at: 1000 }
    const server = account()
    const laptop = device('laptop', clock)
    const phone = device('phone', clock)
    await laptop.write('- [ ] Call the bank\n')
    expect(await laptop.exchange(server)).toBe(true)
    await phone.exchange(server)
    expect(phone.text()).toMatch(/- \[ \] Call the bank/)

    await laptop.write(laptop.text().replace('Call the bank', 'Call the bank today'))
    await phone.write(phone.text().replace('- [ ]', '- [x]'))
    await laptop.exchange(server)
    await phone.exchange(server)
    await laptop.exchange(server)
    expect(laptop.text()).toMatch(/- \[x\] Call the bank today/)
    expect(phone.text()).toMatch(/- \[x\] Call the bank today/)
  })

  test('keeps working offline and sends what waited once the account answers', async () => {
    const clock = { at: 1000 }
    const server = account()
    server.up = false
    const laptop = device('laptop', clock)
    await laptop.write('- [ ] Offline\n')
    expect(await laptop.exchange(server)).toBe(false)
    expect(laptop.pending).toBe(1)
    server.up = true
    expect(await laptop.exchange(server)).toBe(true)
    expect(laptop.pending).toBe(0)
  })

  test('does not take away a to-do that arrived after the text was read', async () => {
    const clock = { at: 1000 }
    const server = account()
    const laptop = device('laptop', clock)
    const phone = device('phone', clock)
    await laptop.write('- [ ] First\n')
    const stale = laptop.text()
    await phone.write('- [ ] From the phone\n')
    await phone.exchange(server)
    await laptop.exchange(server)
    await laptop.write(stale.replace('First', 'First, edited'))
    expect(laptop.text()).toMatch(/From the phone/)
  })

  test('a write made from an older reading neither takes over nor deletes a to-do that arrived since', async () => {
    const clock = { at: 1000 }
    const disk = memoryDisk()
    const window = (name: string) =>
      new InboxRecords(
        disk,
        name,
        () => clock.at,
        () => `${name}${(clock.at += 1)}`,
      )
    const one = window('one')
    const two = window('two')
    await one.write('- [ ] First\n')
    await two.load()
    const read = two.text()
    await one.write(`${one.text()}- [ ] From the other window\n`)
    await two.load()
    two.text()
    await two.write(`${read}- [ ] Mine\n`, read)
    await one.load()
    const lines = one.text().split('\n').filter(Boolean).sort()
    expect(lines).toEqual(['- [ ] First', '- [ ] From the other window', '- [ ] Mine'])
  })

  test('a to-do carried from an old file loses to every later change, on any device', async () => {
    const clock = { at: 1000 }
    const server = account()
    const laptop = device('laptop', clock)
    const phone = device('phone', clock)
    const old = [{ id: 'm1', fields: { text: 'From the file', status: ' ', order: 0 } }]
    await laptop.carry(old)
    await laptop.exchange(server)
    await phone.exchange(server)
    await phone.write(phone.text().replace('- [ ]', '- [x]'))
    await phone.exchange(server)
    await laptop.carry(old)
    await laptop.exchange(server)
    expect(laptop.text()).toMatch(/- \[x\] From the file/)
    const again = device('tablet', clock)
    await again.carry(old)
    await again.exchange(server)
    expect(again.text()).toMatch(/- \[x\] From the file/)
  })

  test('a to-do ticked without a date is given today, and loses it when unticked', async () => {
    const clock = { at: Date.UTC(2026, 10, 7, 12) }
    const laptop = device('laptop', clock)
    await laptop.write('- [ ] Call the bank\n')
    await laptop.write(laptop.text().replace('- [ ]', '- [x]'))
    expect(laptop.text()).toMatch(/✅ 2026-11-0[78]/)
    await laptop.write(
      laptop
        .text()
        .replace('- [x]', '- [ ]')
        .replace(/ ✅ \S+/, ''),
    )
    expect(laptop.text()).not.toMatch(/✅/)
  })

  test('a line written again without its id keeps the to-do it was, not a new one', async () => {
    const clock = { at: 1000 }
    const laptop = device('laptop', clock)
    await laptop.write('- [ ] Call the bank\n- [ ] Water the plants\n')
    const ids = laptop
      .items()
      .map((one) => one.id)
      .sort()
    await laptop.write('- [x] Call the bank\n- [ ] Water the plants\n')
    expect(
      laptop
        .items()
        .map((one) => one.id)
        .sort(),
    ).toEqual(ids)
    expect(laptop.items().filter((one) => one.fields.gone === true)).toEqual([])
  })

  test('two windows writing the same store keep both changes and both waiting sends', async () => {
    const clock = { at: 1000 }
    const shared = new Map<string, Kept>()
    const one = new InboxRecords(
      memoryDisk(shared),
      'one',
      () => clock.at,
      () => `a${(clock.at += 1)}`,
    )
    const two = new InboxRecords(
      memoryDisk(shared),
      'two',
      () => clock.at,
      () => `b${(clock.at += 1)}`,
    )
    await one.write('- [ ] Call the bank\n')
    await two.load()
    clock.at += 10
    await one.write(one.text().replace('Call the bank', 'Call the bank today'))
    clock.at += 10
    await two.write(two.text().replace('- [ ]', '- [x]'))
    await one.load()
    expect(one.text()).toMatch(/- \[x\] Call the bank today/)
    const server = account()
    expect(await one.exchange(server)).toBe(true)
    expect(one.pending).toBe(0)
    const phone = device('phone', clock)
    await phone.exchange(server)
    expect(phone.text()).toMatch(/- \[x\] Call the bank today/)
  })

  test('one to-do too large for the account keeps the rest from waiting behind it', async () => {
    const clock = { at: 1000 }
    const server = account()
    const strict: InboxServer = {
      pull: (since) => server.pull(since),
      push: (changes) => {
        if (!inboxChangesOf({ changes })) return Promise.reject(new Error('400'))
        return server.push(changes)
      },
    }
    const laptop = device('laptop', clock)
    await laptop.write(`- [ ] Read this\n${'long words '.repeat(2000)}\n- [ ] Call the bank\n`)
    expect(await laptop.exchange(strict)).toBe(true)
    expect(laptop.pending).toBe(1)

    const phone = device('phone', clock)
    await phone.exchange(server)
    expect(phone.text()).toMatch(/- \[ \] Call the bank/)
  })
})
