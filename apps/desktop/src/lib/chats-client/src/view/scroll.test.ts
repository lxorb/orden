import type { Message, Who } from '@orden/chats'
import { describe, expect, test } from 'vitest'
import { messageOf } from '../test-account'
import { atBottom, glides, ownSent } from './scroll'
import { type Item, rowsOf } from './rows'

const EMIL: Who = 'user:emil'
const MIA: Who = 'user:mia'
const START = Date.UTC(2026, 9, 2, 9, 0)
const said = (seq: number, author: Who, more: Partial<Message> = {}) =>
  messageOf(seq, { id: `m${seq}`, at: START + seq * 1000, author, ...more })
function rows(messages: Message[], outbox: Message[] = []): Item[] {
  return rowsOf({
    messages,
    outbox,
    me: EMIL,
    readAtOpen: null,
    dayOf: (at) => new Date(at).toISOString().slice(0, 10),
    reads: new Map(),
  })
}
describe('scrolling', () => {
  test('the reader is at the bottom within a few pixels of it', () => {
    expect(atBottom({ scrollTop: 596, clientHeight: 400, scrollHeight: 1000 })).toBe(true)
    expect(atBottom({ scrollTop: 590, clientHeight: 400, scrollHeight: 1000 })).toBe(false)
  })
  test('the way to the newest glides only over a few screens, and jumps further', () => {
    expect(glides(900, 400)).toBe(true)
    expect(glides(1200, 400)).toBe(true)
    expect(glides(1201, 400)).toBe(false)
    expect(glides(0, 400)).toBe(false)
  })
})
describe('optimistic sends', () => {
  const placed = [said(1, MIA), said(2, EMIL)]
  test('a post of mine shows at once as a pending row at the end, and the list follows it', () => {
    const before = rows(placed)
    const after = rows(placed, [said(3, EMIL, { id: 'local' })])
    const last = after.at(-1)
    expect(last?.kind === 'message' && last.pending && last.key).toBe('local')
    expect(ownSent(before, after, EMIL)).toBe('local')
  })
  test('the same pending row a second time, or someone else’s message, does not pull the reader down', () => {
    const sending = rows(placed, [said(3, EMIL, { id: 'local' })])
    expect(ownSent(sending, rows(placed, [said(3, EMIL, { id: 'local' })]), EMIL)).toBeNull()
    expect(ownSent(rows(placed), rows([...placed, said(3, MIA)]), EMIL)).toBeNull()
    expect(ownSent(rows(placed), rows(placed, [said(3, EMIL)]), null)).toBeNull()
  })
  test('a pending row that lands keeps its key, so the row stays where it is drawn', () => {
    const sending = rows(placed, [said(3, EMIL, { id: 'local' })])
    const landed = rows([...placed, said(3, EMIL, { id: 'local' })])
    const keys = (items: Item[]) => items.map((item) => item.key)
    expect(keys(landed)).toEqual(keys(sending))
    const at = (items: Item[]) => items.find((item) => item.key === 'local')
    const pending = at(sending)
    const done = at(landed)
    expect(pending?.kind === 'message' && pending.head).toBe(done?.kind === 'message' && done.head)
    expect(ownSent(sending, landed, EMIL)).toBeNull()
  })
})
