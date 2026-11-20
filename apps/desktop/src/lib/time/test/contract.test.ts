import { describe, expect, test } from 'vitest'
import {
  dayTotals,
  mergeBlocks,
  moveBlock,
  placeBlock,
  removeBlock,
  resizeBlock,
  rangeTotals,
  setActivity,
  type Span,
  splitBlock,
  takesTime,
  unset,
  type Write,
} from '../src/api'
import type { TimeDisk } from '../src/disk'
import type { Row } from '../src/ledger'
import { TimeStore } from '../src/store.svelte'
import { csvOf, jsonOf, recordsIn } from '../src/written'

describe('what the time is written out as', () => {
  const span: Span = {
    id: 's',
    start: Date.UTC(2026, 10, 5, 9),
    end: Date.UTC(2026, 10, 5, 10, 30),
    activity: 'uni',
    tags: [],
    note: '=SUM(A1)',
    source: 'timer',
    place: null,
    label: null,
    device: null,
  }
  const uni = { id: 'uni', name: 'Uni', tint: null, icon: null, parent: null, archived: false, order: 1 }
  test('a spreadsheet row a span, its length in minutes, and no formula a note starts with', () => {
    const [head, row] = csvOf([span], [uni], 0).split('\r\n')
    expect(head).toBe('start,end,minutes,activity,tags,note,source,place')
    expect(row).toBe("2026-11-05T09:00:00.000Z,2026-11-05T10:30:00.000Z,90,Uni,,'=SUM(A1),timer,")
  })
  test('the records come back from their own file and from nothing else', () => {
    const records = [{ kind: 'span', id: 'a1', value: { start: 1 } }]
    expect(recordsIn(jsonOf(records))).toEqual(records)
    expect(recordsIn('{"format":"other","records":[]}')).toBeNull()
    expect(recordsIn('not json')).toBeNull()
    expect(recordsIn(jsonOf([{ kind: 'Span!', id: 'a1', value: {} }]))).toEqual([])
  })
})
const M = 60_000
const H = 60 * M
const block = (
  id: string,
  start: number,
  end: number | null,
  activity: string | null = id,
  change: Partial<Span> = {},
): Span => ({
  id,
  start,
  end,
  activity,
  tags: [],
  note: '',
  source: end === null ? 'timer' : 'manual',
  place: null,
  label: null,
  device: null,
  ...change,
})
function applied(spans: readonly Span[], writes: readonly Write[]): Span[] {
  let out = [...spans]
  for (const one of writes) {
    if (one.kind === 'remove') out = out.filter((span) => span.id !== one.id)
    else out = [...out.filter((span) => span.id !== one.span.id), one.span]
  }
  return out.sort((one, other) => one.start - other.start)
}
const laid = (spans: readonly Span[]) =>
  spans.filter((one) => one.source !== 'app').map((one) => [one.activity, one.start, one.end])
describe('the schedule, one track of blocks a person edits after the fact', () => {
  const day = [
    block('work', 9 * H, 12 * H),
    block('uni', 13 * H, 15 * H),
    block('app', 9 * H, 15 * H, null, { source: 'app', place: 'x' }),
  ]
  const now = 16 * H
  test('a block placed over others trims them, splits the one it lands inside, and takes the place of the ones it covers', () => {
    const placed = applied(day, placeBlock(day, 10 * H, 11 * H, 'eat', now))
    expect(placed.find((one) => one.id === 'app')).toEqual(day[2])
    expect(laid(placed)).toEqual([
      ['work', 9 * H, 10 * H],
      ['eat', 10 * H, 11 * H],
      ['work', 11 * H, 12 * H],
      ['uni', 13 * H, 15 * H],
    ])
    expect(laid(applied(day, placeBlock(day, 11 * H, 14 * H, 'eat', now)))).toEqual([
      ['work', 9 * H, 11 * H],
      ['eat', 11 * H, 14 * H],
      ['uni', 14 * H, 15 * H],
    ])
    expect(laid(applied(day, placeBlock(day, 8 * H, 16 * H, 'eat', now)))).toEqual([['eat', 8 * H, 16 * H]])
    expect(placeBlock(day, 10 * H, 10 * H, 'eat', now)).toEqual([])
  })
  test('a block moved keeps its length and overwrites where it lands; resized, it overwrites what it grows over', () => {
    expect(laid(applied(day, moveBlock(day, 'uni', 11 * H, now)))).toEqual([
      ['work', 9 * H, 11 * H],
      ['uni', 11 * H, 13 * H],
    ])
    expect(laid(applied(day, resizeBlock(day, 'uni', 11 * H, 15 * H, now)))).toEqual([
      ['work', 9 * H, 11 * H],
      ['uni', 11 * H, 15 * H],
    ])
    expect(resizeBlock(day, 'uni', 15 * H, 13 * H, now)).toEqual([])
  })
  test('a block changes its activity or goes, and what was recorded on its own is never edited', () => {
    expect(laid(applied(day, setActivity(day, 'work', 'uni')))[0]).toEqual(['uni', 9 * H, 12 * H])
    expect(laid(applied(day, removeBlock(day, 'work')))).toEqual([['uni', 13 * H, 15 * H]])
    expect(setActivity(day, 'app', 'uni')).toEqual([])
    expect(removeBlock(day, 'app')).toEqual([])
    expect(moveBlock(day, 'app', 0, now)).toEqual([])
  })
  test('the running timer counts up to now: its end cannot be moved, and a block over it splits it, stops it or replaces it', () => {
    const running = [block('work', 9 * H, null)]
    expect(moveBlock(running, 'work', 8 * H, now)).toEqual([])
    expect(laid(applied(running, resizeBlock(running, 'work', 8 * H, 20 * H, now)))).toEqual([['work', 8 * H, null]])
    const inside = applied(running, placeBlock(running, 10 * H, 11 * H, 'eat', now))
    expect(laid(inside)).toEqual([
      ['work', 9 * H, 10 * H],
      ['eat', 10 * H, 11 * H],
      ['work', 11 * H, null],
    ])
    expect(inside.find((one) => one.end === null)?.id).toBe('work')
    expect(laid(applied(running, placeBlock(running, 15 * H, 17 * H, 'eat', now)))).toEqual([
      ['work', 9 * H, 15 * H],
      ['eat', 15 * H, 17 * H],
    ])
    expect(laid(applied(running, placeBlock(running, 8 * H, now, 'eat', now)))).toEqual([['eat', 8 * H, now]])
  })
  test('active stretches no block covers are the ones not set, once they last a quarter of an hour', () => {
    const minutes = (from: number, to: number) =>
      Array.from({ length: (to - from) / M }, (_, index) => ({
        at: from + index * M,
        active: 40,
        samples: 12,
        lid: true,
        locked: false,
      }))
    const all = [...minutes(10 * H, 11 * H), ...minutes(12 * H, 13 * H), ...minutes(16 * H, 16 * H + 10 * M)]
    expect(unset(day, all, 0, 24 * H, 17 * H)).toEqual([{ from: 12 * H, to: 13 * H, active: 60 * 40_000 }])
  })
})
describe('the day in numbers, for the pie', () => {
  const day = new Date(2026, 10, 19).getTime()
  const next = new Date(2026, 10, 20).getTime()
  test('each activity once, the running timer up to now, and nothing from the day before or the automatic rows', () => {
    const spans = [
      block('sleep', day - 2 * H, day + H),
      block('work', day + 9 * H, day + 12 * H),
      block('uni', day + 11 * H, day + 13 * H),
      block('lost', day + 14 * H, day + 15 * H, null),
      block('app', day, day + 20 * H, 'work', { source: 'app', place: 'x' }),
      block('running', day + 16 * H, null, 'work'),
    ]
    const totals = dayTotals(spans, day, day + 17 * H)
    expect(totals.slices).toEqual([
      { activity: 'work', ms: 3 * H },
      { activity: 'uni', ms: 2 * H },
      { activity: 'sleep', ms: H },
      { activity: null, ms: H },
    ])
    expect(totals.ms).toBe(7 * H)
  })
  test('a block across midnight counts in each day for its part', () => {
    const spans = [block('night', next - H, next + 2 * H)]
    expect(dayTotals(spans, day, next + 5 * H)).toEqual({ slices: [{ activity: 'night', ms: H }], ms: H })
    expect(dayTotals(spans, next, next + 5 * H)).toEqual({ slices: [{ activity: 'night', ms: 2 * H }], ms: 2 * H })
  })
})
function memory(name: string): TimeDisk {
  const rows: Record<string, Row> = {}
  return {
    name,
    rows: () => Promise.resolve(Object.values(rows)),
    put: (list) => {
      for (const one of list) rows[`${one.kind}:${one.id}`] = one
      return Promise.resolve()
    },
    read: () => Promise.resolve(undefined),
    keep: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    minutes: () => Promise.resolve([]),
    keepMinutes: () => Promise.resolve(),
    close: () => undefined,
  }
}
describe('an edit to the schedule that removes or cuts recorded time can be taken back', () => {
  async function opened(name: string) {
    const store = new TimeStore(() => Promise.resolve(memory(name)))
    await store.opened({ owner: null, server: null, device: 'here' })
    const work = store.addActivity('Work')
    store.schedule([
      { kind: 'add', span: block('a', 9 * H, 10 * H, work.id) },
      { kind: 'add', span: block('b', 11 * H, 12 * H, work.id) },
    ])
    return store
  }
  const shown = (store: TimeStore) => store.spans.map((one) => [one.id, one.start, one.end])
  test('a block moved over another takes its place, and one undo brings both back as they were, and redo again', async () => {
    const store = await opened('moved')
    const writes = moveBlock(store.spans, 'a', 11 * H, 16 * H)
    expect(takesTime(store.spans, writes, 16 * H)).toBe(true)
    store.schedule(writes)
    expect(shown(store)).toEqual([['a', 11 * H, 12 * H]])
    expect(store.undoSchedule()).toBe(true)
    expect(shown(store)).toEqual([
      ['a', 9 * H, 10 * H],
      ['b', 11 * H, 12 * H],
    ])
    expect(store.redoSchedule()).toBe(true)
    expect(shown(store)).toEqual([['a', 11 * H, 12 * H]])
  })
  test('a block deleted, cut or split comes back whole, and what the edit added goes', async () => {
    const store = await opened('cut')
    const removed = store.schedule(removeBlock(store.spans, 'b'))
    expect(shown(store)).toEqual([['a', 9 * H, 10 * H]])
    expect(store.undoSchedule(removed)).toBe(true)
    const placed = placeBlock(store.spans, 11.25 * H, 11.5 * H, null, 16 * H, 'c')
    expect(takesTime(store.spans, placed, 16 * H)).toBe(true)
    store.schedule(placed)
    expect(shown(store)).toHaveLength(4)
    store.undoSchedule()
    expect(shown(store)).toEqual([
      ['a', 9 * H, 10 * H],
      ['b', 11 * H, 12 * H],
    ])
    const grown = resizeBlock(store.spans, 'a', 9 * H, 11.5 * H, 16 * H)
    store.schedule(grown)
    expect(shown(store)).toEqual([
      ['a', 9 * H, 11.5 * H],
      ['b', 11.5 * H, 12 * H],
    ])
    store.undoSchedule()
    expect(shown(store)).toEqual([
      ['a', 9 * H, 10 * H],
      ['b', 11 * H, 12 * H],
    ])
  })
  test('an edit that only adds or moves into free time takes nothing', async () => {
    const store = await opened('free')
    expect(takesTime(store.spans, moveBlock(store.spans, 'a', 13 * H, 16 * H), 16 * H)).toBe(false)
    expect(takesTime(store.spans, placeBlock(store.spans, 14 * H, 15 * H, null, 16 * H), 16 * H)).toBe(false)
    expect(takesTime(store.spans, setActivity(store.spans, 'a', null), 16 * H)).toBe(false)
  })
})
describe('a block split or merged, and the time of any range with and without the untracked time', () => {
  const now = 20 * H
  const day = [block('a', 9 * H, 11 * H, 'work'), block('b', 12 * H, 13 * H, 'eat'), block('c', 14 * H, null, 'work')]
  test('a block splits where it is cut, the later half keeping its place; merged, it grows over the other and the gap', () => {
    expect(laid(applied(day, splitBlock(day, 'a', 10 * H, now))).slice(0, 2)).toEqual([
      ['work', 9 * H, 10 * H],
      ['work', 10 * H, 11 * H],
    ])
    expect(applied(day, splitBlock(day, 'a', 10 * H, now)).find((one) => one.id === 'a')?.start).toBe(10 * H)
    expect(splitBlock(day, 'a', 11 * H, now)).toEqual([])
    expect(laid(applied(day, mergeBlocks(day, 'a', 'b', now)))).toEqual([
      ['work', 9 * H, 13 * H],
      ['work', 14 * H, null],
    ])
    expect(laid(applied(day, mergeBlocks(day, 'b', 'c', now)))).toEqual([
      ['work', 9 * H, 11 * H],
      ['eat', 12 * H, null],
    ])
  })
  test('the untracked time is the active time no block holds and the blocks without an activity', () => {
    const minutes = Array.from({ length: 30 }, (_, index) => ({
      at: 15 * H + index * M,
      active: 30,
      samples: 12,
      lid: null,
      locked: false,
    }))
    const spans = [block('a', 9 * H, 11 * H, 'work'), block('n', 11 * H, 11.5 * H, null)]
    const off = rangeTotals(spans, minutes, 0, 24 * H, now, { untracked: false })
    expect(off).toEqual({ slices: [{ activity: 'work', ms: 2 * H }], ms: 2 * H, untracked: 0 })
    const on = rangeTotals(spans, minutes, 0, 24 * H, now, { untracked: true })
    expect(on.slices).toEqual([
      { activity: 'work', ms: 2 * H },
      { activity: null, ms: H },
    ])
    expect(on.ms).toBe(3 * H)
    expect(on.untracked).toBe(H)
  })
})
