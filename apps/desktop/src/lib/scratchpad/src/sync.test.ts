import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import type { PadTrade } from '@orden/sync-core'
import { applied, type Edit } from '@orden/scan/search/replace'
import { type PadDisk, type PadServer, PadSync, type PadText } from './sync'

class Account implements PadServer {
  readonly doc = new Y.Doc()
  down = false
  missing = false
  trades = 0

  trade(trade: PadTrade) {
    this.trades++
    if (this.down) return Promise.reject(new TypeError('offline'))
    if (this.missing) return Promise.resolve(null)
    Y.applyUpdateV2(this.doc, trade.update)
    return Promise.resolve({
      update: Y.encodeStateAsUpdateV2(this.doc, trade.sv),
      sv: Y.encodeStateVector(this.doc),
    })
  }
}

class Pad implements PadText {
  words = ''
  typing: string | null = null
  failing = false

  now() {
    return Promise.resolve(this.words)
  }

  async takeIn(change: (now: string) => readonly Edit[], settle: (after: string) => Promise<void>) {
    if (this.typing !== null) {
      this.words = this.typing
      this.typing = null
    }
    const after = applied(this.words, change(this.words))
    await settle(after)
    if (this.failing) throw new Error('the device stopped')
    this.words = after
  }
}

function disk(): PadDisk & { held: Map<string, unknown> } {
  const held = new Map<string, unknown>()
  return {
    held,
    read: (key) => Promise.resolve(structuredClone(held.get(key))),
    keep: (key, value) => {
      held.set(key, structuredClone(value))
      return Promise.resolve()
    },
  }
}

const now = <T>(_name: string, run: () => Promise<T>) => run()

function device(words = '', kept = disk()) {
  const pad = new Pad()
  pad.words = words
  return { pad, kept, sync: new PadSync(pad, kept, now) }
}

describe('the scratchpad on every device of the account', () => {
  test('reaches a second device', async () => {
    const account = new Account()
    const desk = device('call the bank')
    const phone = device()

    expect(await desk.sync.exchange('me', account)).toBe('synced')
    await phone.sync.exchange('me', account)
    expect(phone.pad.words).toBe('call the bank')
  })

  test('keeps every word two devices wrote at once', async () => {
    const account = new Account()
    const desk = device('milk\neggs\n')
    const phone = device()
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)

    desk.pad.words = 'oat milk\neggs\n'
    phone.pad.words = 'milk\neggs\nbutter\n'
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)
    await desk.sync.exchange('me', account)

    expect(desk.pad.words).toBe('oat milk\neggs\nbutter\n')
    expect(phone.pad.words).toBe(desk.pad.words)
  })

  test('sends what was written offline once the account answers again', async () => {
    const account = new Account()
    const desk = device('one')
    const phone = device()
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)

    account.down = true
    desk.pad.words = 'one two'
    await expect(desk.sync.exchange('me', account)).rejects.toThrow('offline')
    phone.pad.words = 'zero one'
    await expect(phone.sync.exchange('me', account)).rejects.toThrow('offline')

    account.down = false
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)
    await desk.sync.exchange('me', account)
    expect(desk.pad.words).toBe('zero one two')
    expect(phone.pad.words).toBe('zero one two')
  })

  test('keeps both scratchpads when a device that had its own joins', async () => {
    const account = new Account()
    const desk = device('from the desk\n')
    const phone = device('from the phone\n')
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)
    await desk.sync.exchange('me', account)

    expect(phone.pad.words).toBe('from the desk\n\nfrom the phone\n')
    expect(desk.pad.words).toBe(phone.pad.words)
  })

  test('takes nothing twice when a joining device already says the same', async () => {
    const account = new Account()
    const desk = device('same words\n')
    const phone = device('same words\n')
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)
    expect(phone.pad.words).toBe('same words\n')
  })

  test('keeps words typed while the account was answering', async () => {
    const account = new Account()
    const desk = device('a')
    const phone = device()
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)

    phone.pad.words = 'a b'
    await phone.sync.exchange('me', account)
    desk.pad.typing = 'a c'
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)

    expect(desk.pad.words).toMatch(/^a (b c|c b)$/)
    expect(phone.pad.words).toBe(desk.pad.words)
  })

  test('stays on the device while the account does not know the scratchpad', async () => {
    const account = new Account()
    account.missing = true
    const desk = device('only here')
    expect(await desk.sync.exchange('me', account)).toBe('local')
    expect(desk.pad.words).toBe('only here')
    expect(desk.kept.held.size).toBe(0)

    const phone = device('on the phone')
    account.missing = false
    await phone.sync.exchange('me', account)
    await desk.sync.exchange('me', account)
    expect(desk.pad.words).toBe('on the phone\n\nonly here\n')
  })

  test('writes nothing twice when the device stops between keeping and writing', async () => {
    const account = new Account()
    const desk = device('start')
    const phone = device()
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)

    phone.pad.words = 'start from the phone'
    await phone.sync.exchange('me', account)
    desk.pad.failing = true
    await expect(desk.sync.exchange('me', account)).rejects.toThrow('stopped')
    expect(desk.pad.words).toBe('start')

    desk.pad.failing = false
    desk.pad.words = 'desk: start'
    await desk.sync.exchange('me', account)
    await phone.sync.exchange('me', account)
    expect(desk.pad.words).toBe('desk: start from the phone')
    expect(phone.pad.words).toBe(desk.pad.words)
  })

  test('takes the same words in two windows of one device once', async () => {
    const account = new Account()
    const kept = disk()
    const one = device('shared', kept)
    const two = { ...one, sync: new PadSync(one.pad, kept, now) }
    await one.sync.exchange('me', account)
    one.pad.words = 'shared words'
    await one.sync.exchange('me', account)
    await two.sync.exchange('me', account)
    await two.sync.exchange('me', account)

    const fresh = device()
    await fresh.sync.exchange('me', account)
    expect(fresh.pad.words).toBe('shared words')
  })

  test('never carries one account’s scratchpad into another', async () => {
    const mine = new Account()
    const theirs = new Account()
    const desk = device('my words')
    await desk.sync.exchange('me', mine)

    const elsewhere = device('their words')
    await elsewhere.sync.exchange('them', theirs)
    await desk.sync.exchange('them', theirs)
    expect(desk.pad.words).toBe('their words')

    await desk.sync.exchange('me', mine)
    expect(desk.pad.words).toBe('my words')
    expect(theirs.doc.getText('note').toJSON()).toBe('their words')
    expect(mine.doc.getText('note').toJSON()).toBe('my words')
  })

  test('carries nothing written just before signing out into the next account', async () => {
    const mine = new Account()
    const theirs = new Account()
    const desk = device('my words')
    await desk.sync.exchange('me', mine)

    desk.pad.words = 'my words\nand a secret'
    await desk.sync.left('me')
    await desk.sync.exchange('them', theirs)

    expect(theirs.doc.getText('note').toJSON()).toBe('')
    expect(desk.pad.words).toBe('')
  })

  test('still carries what was written after signing out', async () => {
    const mine = new Account()
    const theirs = new Account()
    const desk = device('my words')
    await desk.sync.exchange('me', mine)
    await desk.sync.left('me')

    desk.pad.words = 'written signed out'
    await desk.sync.exchange('them', theirs)

    expect(theirs.doc.getText('note').toJSON()).toBe('written signed out')
  })
})
