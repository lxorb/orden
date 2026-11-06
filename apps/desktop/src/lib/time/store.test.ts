import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openTimeDisk } from './disk'
import { FakeTimeServer, OLD_SERVER } from './fake-server'
import { TimeStore } from './store.svelte'

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

    store.start(uni.id, 1000)
    expect(store.running.map((one) => one.activity)).toEqual([uni.id])
    store.start(sport.id, 5000)
    expect(store.running.map((one) => one.activity)).toEqual([sport.id])
    store.stop(9000)
    expect(store.running).toEqual([])
    expect(store.spans.map((one) => [one.activity, one.start, one.end, one.source])).toEqual([
      [uni.id, 1000, 5000, 'timer'],
      [sport.id, 5000, 9000, 'timer'],
    ])
    expect(store.latest().map((one) => one.name)).toEqual(['Sport', 'Uni'])
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
    one.start(one.addActivity('Uni').id, 10)
    await one.exchange()

    const other = new TimeStore((one) => openTimeDisk(one === null ? null : `${one}-elsewhere`))
    await other.opened({ owner: who, server, device: 'there' })
    await other.exchange()
    expect(other.running.map((span) => span.device)).toEqual(['here'])
    other.stop(20)
    await other.exchange()
    await one.exchange()
    expect(one.running).toEqual([])
    expect(one.spans[0]?.end).toBe(20)
    expect(one.kept).toBe(true)
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
})
