import { describe, expect, test } from 'vitest'
import { FakeTimeServer, OLD_SERVER } from './fake-server'
import { exchange } from './exchange'
import { Ledger } from './ledger'
import { activityOf, spanOf } from './records'

const entry = (id: string, value: Record<string, unknown> | null, seq: number) => ({
  kind: 'span',
  id,
  value,
  seq,
  at: seq,
})

describe('the ledger of time records', () => {
  test('takes what the account says about a record it has no change of its own to', () => {
    const ledger = new Ledger()
    ledger.pulled([entry('a', { start: 1 }, 1)])
    expect(ledger.get('span', 'a')?.value).toEqual({ start: 1 })
  })

  test('keeps a change not sent yet over what the account says', () => {
    const ledger = new Ledger()
    ledger.write('span', 'a', { start: 5 }, 0)
    ledger.pulled([entry('a', { start: 1 }, 1)])
    expect(ledger.get('span', 'a')?.value).toEqual({ start: 5 })
  })

  test('counts a change sent only when nothing newer was written while it went', () => {
    const ledger = new Ledger()
    const first = ledger.write('span', 'a', { start: 1 }, 0)
    ledger.write('span', 'a', { start: 2 }, 0)
    expect(ledger.sent([first])).toEqual([])
    expect(ledger.pending(10)).toHaveLength(1)
  })

  test('holds a taken-away record as a tombstone, and lists only the live ones', () => {
    const ledger = new Ledger()
    ledger.write('span', 'a', { start: 1 }, 0)
    ledger.write('span', 'a', null, 0)
    ledger.write('span', 'b', { start: 1 }, 0)
    expect(ledger.live('span').map((one) => one.id)).toEqual(['b'])
    expect(ledger.pending(10).map((one) => one.id)).toEqual(['a', 'b'])
  })

  test('goes on numbering its changes after the ones it was opened with', () => {
    const ledger = new Ledger([{ kind: 'span', id: 'a', value: {}, dirty: 7, at: 0 }])
    expect(ledger.write('span', 'b', {}, 0).dirty).toBe(8)
  })
})

describe('trading time records with the account', () => {
  test('sends what is pending, then takes every page since the cursor', async () => {
    const server = new FakeTimeServer()
    await server.push([{ kind: 'span', id: 'theirs', value: { start: 2 } }])
    const ledger = new Ledger()
    ledger.write('span', 'mine', { start: 1 }, 0)

    const done = await exchange(ledger, server, 0)
    expect(done.reached).toBe(true)
    expect(done.cursor).toBe(2)
    expect(ledger.pending(10)).toEqual([])
    expect(
      ledger
        .live('span')
        .map((one) => one.id)
        .sort(),
    ).toEqual(['mine', 'theirs'])
  })

  test('two devices end with the same records, the later write of one record winning', async () => {
    const server = new FakeTimeServer()
    const one = new Ledger()
    const other = new Ledger()
    one.write('span', 'a', { start: 1 }, 0)
    const cursors = [
      (await exchange(one, server, 0)).cursor,
      (await exchange(other, server, 0)).cursor,
    ]
    other.write('span', 'a', { start: 9 }, 0)
    one.write('span', 'b', { start: 3 }, 0)
    cursors[1] = (await exchange(other, server, cursors[1] ?? 0)).cursor
    cursors[0] = (await exchange(one, server, cursors[0] ?? 0)).cursor
    await exchange(other, server, cursors[1])

    const seen = (ledger: Ledger) =>
      ledger
        .live('span')
        .map((row) => [row.id, row.value?.start])
        .sort()
    expect(seen(one)).toEqual([
      ['a', 9],
      ['b', 3],
    ])
    expect(seen(other)).toEqual(seen(one))
  })

  test('keeps everything on the device when the account has no time records yet', async () => {
    const ledger = new Ledger()
    ledger.write('span', 'a', { start: 1 }, 0)
    const done = await exchange(ledger, OLD_SERVER, 4)
    expect(done).toEqual({ cursor: 4, written: [], reached: false })
    expect(ledger.pending(10)).toHaveLength(1)
  })
})

describe('reading a time record', () => {
  test('a span with no end is running, and one ending before it starts is nothing', () => {
    expect(spanOf('a', { start: 10 })?.end).toBeNull()
    expect(spanOf('a', { start: 10, end: 5 })).toBeNull()
    expect(spanOf('a', { start: 'soon' })).toBeNull()
  })

  test('a span keeps its tags once each, and a source it does not know is a manual one', () => {
    const span = spanOf('a', { start: 1, tags: ['x', 'x', ' y ', 3], source: 'magic' })
    expect(span?.tags).toEqual(['x', 'y'])
    expect(span?.source).toBe('manual')
  })

  test('an activity has a name, and a tint only from the theme’s own', () => {
    expect(activityOf('a', { name: '  ' })).toBeNull()
    expect(activityOf('a', { name: 'Uni', tint: 'teal' })?.tint).toBe('teal')
    expect(activityOf('a', { name: 'Uni', tint: '#fff' })?.tint).toBeNull()
  })
})
