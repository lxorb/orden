import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../../../scripts/growth'
import { openTimeDisk } from './disk'
import { FakeTimeServer, OLD_SERVER } from './fake-server'
import type { Span } from './records'
import { TimeStore } from './store.svelte'

const M = 60_000

let owners = 0
const owner = () => `owner-${(owners += 1)}`

async function opened(who: string | null, server: FakeTimeServer | typeof OLD_SERVER | null) {
  const store = new TimeStore()
  await store.opened({ owner: who, server, device: 'here' })
  return store
}

describe('the time a person records', () => {
  test('a timer runs until it is stopped, and starting another stops the first', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni', 'teal')
    const sport = store.addActivity('Sport')

    store.start(uni.id, M)
    expect(store.running.map((one) => one.activity)).toEqual([uni.id])
    store.start(sport.id, 5 * M)
    expect(store.running.map((one) => one.activity)).toEqual([sport.id])
    store.stop(9 * M)
    expect(store.running).toEqual([])
    expect(store.spans.map((one) => [one.activity, one.start, one.end, one.source])).toEqual([
      [uni.id, M, 5 * M, 'timer'],
      [sport.id, 5 * M, 9 * M, 'timer'],
    ])
    expect(store.latest().map((one) => one.name)).toEqual(['Sport', 'Uni'])
  })

  test('a timer stopped or changed within its first minute keeps nothing', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni')
    const sport = store.addActivity('Sport')

    store.start(uni.id, 10 * M)
    store.start(sport.id, 10 * M + 1000)
    store.stop(10 * M + 50_000)
    expect(store.spans).toEqual([])

    store.start(uni.id, 20 * M)
    store.stop(20 * M - 1000)
    expect(store.spans.map((one) => [one.start, one.end])).toEqual([[20 * M, 20 * M]])
  })

  test('a span added by hand is edited and taken away, and refuses to end before it starts', async () => {
    const store = await opened(owner(), null)
    const span = store.addSpan({ start: 100, end: 200, tags: ['reading'], note: 'ch. 3' })
    store.changeSpan(span.id, { end: 50 })
    expect(store.span(span.id)?.end).toBe(200)
    store.changeSpan(span.id, { end: 300 })
    expect(store.span(span.id)?.end).toBe(300)
    store.removeSpan(span.id)
    expect(store.spans).toEqual([])
  })

  test('keeps its spans in order of their start as each is added, moved or taken away', async () => {
    const store = await opened(owner(), null)
    const late = store.addSpan({ start: 300, end: 400 })
    const early = store.addSpan({ start: 100, end: 150 })
    const middle = store.addSpan({ start: 200, end: 250 })
    store.changeSpan(late.id, { start: 50 })
    store.removeSpan(middle.id)
    expect(store.spans.map((one) => [one.id, one.start])).toEqual([
      [late.id, 50],
      [early.id, 100],
    ])
  })

  test('taking an activity away leaves its spans without one', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni')
    store.addSpan({ start: 1, end: 2, activity: uni.id })
    store.removeActivity(uni.id)
    expect(store.activities).toEqual([])
    expect(store.spans.map((one) => one.activity)).toEqual([null])
  })

  test('is still there when the device opens it again', async () => {
    const who = owner()
    const store = await opened(who, null)
    store.addActivity('Uni')
    await new Promise((go) => setTimeout(go, 20))
    const again = await opened(who, null)
    expect(again.activities.map((one) => one.name)).toEqual(['Uni'])
  })

  test('reaches another device through the account', async () => {
    const server = new FakeTimeServer()
    const who = owner()
    const one = await opened(who, server)
    one.start(one.addActivity('Uni').id, 10 * M)
    await one.exchange()

    const other = new TimeStore((one) => openTimeDisk(one === null ? null : `${one}-elsewhere`))
    await other.opened({ owner: who, server, device: 'there' })
    await other.exchange()
    expect(other.running.map((span) => span.device)).toEqual(['here'])
    other.stop(20 * M)
    await other.exchange()
    await one.exchange()
    expect(one.running).toEqual([])
    expect(one.spans[0]?.end).toBe(20 * M)
    expect(one.kept).toBe(true)
  })

  test('a span too large for the account keeps the rest from waiting behind it', async () => {
    const server = new FakeTimeServer()
    const who = owner()
    const one = await opened(who, server)
    one.addSpan({ start: 10 * M, end: 20 * M, note: '漢'.repeat(2000), tags: ['x'.repeat(2000)] })
    const pasted = one.addSpan({ start: 30 * M, end: 40 * M })
    one.changeSpan(pasted.id, { note: 'words '.repeat(1000) })
    const short = one.addSpan({ start: 50 * M, end: 60 * M, note: 'Lunch' })
    await one.exchange()

    const other = new TimeStore((one) => openTimeDisk(one === null ? null : `${one}-elsewhere`))
    await other.opened({ owner: who, server, device: 'there' })
    await other.exchange()
    expect(other.spans.map((span) => span.id)).toEqual([pasted.id, short.id])
    expect(other.spans[0]?.note).toBe(one.span(pasted.id)?.note)
  })

  test('keeps everything on the device against a server that has no time records', async () => {
    const who = owner()
    const store = await opened(who, OLD_SERVER)
    store.addActivity('Uni')
    await store.exchange()
    expect(store.kept).toBe(false)

    const server = new FakeTimeServer()
    const later = await opened(who, server)
    await later.exchange()
    expect([...server.entries.values()].map((one) => one.value?.name)).toEqual(['Uni'])
    expect(later.kept).toBe(true)
  })

  test('counts a space as an activity, changes it, and lets it go with the activity', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni')
    const sport = store.addActivity('Sport')
    store.countAs('space', 'space-1', uni.id)
    store.countAs('space', 'space-1', sport.id)
    expect(store.rules.map((one) => [one.place, one.activity])).toEqual([['space-1', sport.id]])
    store.countAs('site', 'moodle.ethz.ch', uni.id)
    store.removeActivity(sport.id)
    expect(store.rules.map((one) => one.place)).toEqual(['moodle.ethz.ch'])
    store.countAs('site', 'moodle.ethz.ch', null)
    expect(store.rules).toEqual([])
  })

  test('records what happens until paused, on every device of the account', async () => {
    const server = new FakeTimeServer()
    const who = owner()
    const one = await opened(who, server)
    expect(one.recording).toBe(true)
    one.record(false)
    await one.exchange()

    const other = new TimeStore((name) => openTimeDisk(name === null ? null : `${name}-far`))
    await other.opened({ owner: who, server, device: 'there' })
    await other.exchange()
    expect(other.recording).toBe(false)
  })

  test('keeps one goal of each length for an activity, the same on every device', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni')
    store.setGoal(uni.id, 'day', 3_600_000)
    store.setGoal(uni.id, 'day', 7_200_000)
    store.setGoal(uni.id, 'week', 36_000_000)
    expect(store.goals.map((one) => [one.per, one.ms])).toEqual([
      ['day', 7_200_000],
      ['week', 36_000_000],
    ])
    store.setGoal(uni.id, 'week', null)
    expect(store.goalFor(uni.id, 'week')).toBeNull()
    store.removeActivity(uni.id)
    expect(store.goals).toEqual([])
  })

  test('starts a timer by name, finding the activity whatever its case, or making it', async () => {
    const store = await opened(owner(), null)
    const uni = store.addActivity('Uni')
    store.startNamed('  uni ', M)
    store.startNamed('Reading', 2 * M)
    store.startNamed('   ', 3 * M)
    expect(store.activities.map((one) => one.name)).toEqual(['Uni', 'Reading'])
    expect(store.spans.map((one) => [one.activity, one.start, one.end])).toEqual([
      [uni.id, M, 2 * M],
      [store.named('reading')?.id, 2 * M, null],
    ])
    expect(new Set(store.activities.map((one) => one.tint)).size).toBe(2)
  })

  test('keeps the minutes on the device, and only the last ninety days of them', async () => {
    const store = await opened(owner(), null)
    const day = 24 * 3_600_000
    const minute = (at: number) => ({
      at,
      active: 30,
      samples: 12,
      cpu: 0.2,
      memory: 0.5,
      battery: null,
      charging: null,
      lid: true,
      locked: false,
    })
    store.keepMinutes([minute(0), minute(60_000)], 10 * day)
    await new Promise((go) => setTimeout(go, 20))
    expect((await store.minutes(0, day)).map((one) => one.at)).toEqual([0, 60_000])
    store.keepMinutes([minute(100 * day)], 100 * day)
    await new Promise((go) => setTimeout(go, 20))
    expect((await store.minutes(0, 101 * day)).map((one) => one.at)).toEqual([100 * day])
  })

  test('brings in what another export holds, and nothing it has already', async () => {
    const from = await opened(owner(), null)
    from.addSpan({ start: 1, end: 2, note: 'kept' })
    from.addActivity('Uni')
    const into = await opened(owner(), null)
    expect(into.bring(from.everything())).toBe(2)
    expect(into.bring(from.everything())).toBe(0)
    expect(into.spans.map((one) => one.note)).toEqual(['kept'])
    expect(into.activities.map((one) => one.name)).toEqual(['Uni'])
  })

  test('carries what was recorded signed out into the account, once', async () => {
    const local = await opened(null, null)
    local.addActivity('Before')
    await new Promise((go) => setTimeout(go, 20))

    const server = new FakeTimeServer()
    const signed = await opened(owner(), server)
    await signed.exchange()
    expect(signed.activities.map((one) => one.name)).toEqual(['Before'])
    expect([...server.entries.values()]).toHaveLength(1)

    const signedOut = await opened(null, null)
    expect(signedOut.activities).toEqual([])
  })

  test('reaches no account but the one whose records are open while it switches', async () => {
    const first = owner()
    const written = await opened(first, null)
    written.addActivity('Mine')
    await new Promise((go) => setTimeout(go, 20))

    let release: () => void = () => undefined
    const held = new Promise<void>((done) => (release = done))
    const store = new TimeStore(async (who) => {
      if (who === first) await held
      return openTimeDisk(who)
    })
    const theirs = new FakeTimeServer()
    const opening = store.opened({ owner: first, server: null, device: 'here' })
    const exchanging = store.exchange()
    const switching = store.opened({ owner: owner(), server: theirs, device: 'here' })
    release()
    await opening
    await switching
    await exchanging

    expect(theirs.entries.size).toBe(0)
  })

  test('what one window writes shows in another window of the same records at once', async () => {
    const who = owner()
    const one = await opened(who, null)
    const two = await opened(who, null)
    const uni = one.addActivity('Uni')
    const timer = one.start(uni.id, 10 * M)

    await vi.waitFor(() => expect(two.running.map((span) => span.id)).toEqual([timer.id]))
    expect(two.activity(uni.id)?.name).toBe('Uni')

    two.stop(30 * M)
    await vi.waitFor(() => expect(one.running).toEqual([]))
    expect(one.span(timer.id)?.end).toBe(30 * M)

    one.start(uni.id, 40 * M)
    await vi.waitFor(() => expect(two.running).toHaveLength(1))
    expect(two.span(timer.id)?.end).toBe(30 * M)
    expect(one.span(timer.id)?.end).toBe(30 * M)
  })

  test('a window keeps its own later change over an older one heard from another', async () => {
    const who = owner()
    const one = await opened(who, null)
    const two = await opened(who, null)
    const span = one.addSpan({ start: 0, end: M, note: 'first' })
    await vi.waitFor(() => expect(two.span(span.id)?.note).toBe('first'))

    const at = Date.now()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(at + 60_000)
    two.changeSpan(span.id, { note: 'later' })
    now.mockReturnValue(at + 30_000)
    one.changeSpan(span.id, { note: 'earlier' })
    now.mockRestore()

    await vi.waitFor(() => expect(one.span(span.id)?.note).toBe('later'))
    await new Promise((go) => setTimeout(go, 20))
    expect(two.span(span.id)?.note).toBe('later')
  })

  test('a window opened as another writes still hears what it wrote', async () => {
    const who = owner()
    const one = await opened(who, null)
    const two = new TimeStore()
    const opening = two.opened({ owner: who, server: null, device: 'here' })
    const span = one.addSpan({ start: 0, end: M })
    await opening
    await vi.waitFor(() => expect(two.span(span.id)).not.toBeNull())
  })
})

describe('a long history of recorded time', () => {
  test('the recent activities are not looked up again on every read', async () => {
    const stores = new Map<number, TimeStore>()
    for (const size of [2000, 128_000]) {
      const store = await opened(owner(), null)
      const used = store.addActivity('Uni')
      store.addActivity('Never')
      store.spans = Array.from({ length: size }, (_, index): Span => ({
        id: `s${index}`,
        start: index * M,
        end: index * M + M / 2,
        activity: index ? null : used.id,
        tags: [],
        note: '',
        source: 'app',
        place: null,
        label: null,
        device: null,
      }))
      expect(store.latest().map((one) => one.name)).toEqual(['Uni', 'Never'])
      stores.set(size, store)
    }
    const ratio = growth((size) => stores.get(size)?.latest(), 2000, 64)
    expect(ratio).toBeLessThan(GROWS_AT_MOST)
  })
})
