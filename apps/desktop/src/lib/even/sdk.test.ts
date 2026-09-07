import { afterEach, describe, expect, test, vi } from 'vitest'
import { connectGlasses, connectStore, type Input } from './sdk'

/** What the SDK hands back once the channel is open. The real one puts its
 *  singleton on the page and answers with it; this is that, without the SDK,
 *  because the SDK wants a browser and these tests do not have one. */
const fromSdk = vi.hoisted((): { value: unknown } => ({ value: null }))

vi.mock('@evenrealities/even_hub_sdk', () => ({
  waitForEvenAppBridge: () => Promise.resolve(fromSdk.value),
}))

/** The host's side of the bridge, as much as the plugin touches.
 *
 *  A stand-in on `window.EvenAppBridge` is what the SDK itself puts there, so
 *  this is the same door the real one comes through - which is also how the
 *  plugin is driven in a browser. */
class Host {
  readonly calls: { method: string; payload: unknown }[] = []
  push: (event: unknown) => void = () => undefined
  /** What the host answers to an image send. */
  answer: unknown = 'success'
  page: unknown = 0

  createStartUpPageContainer(page: unknown): Promise<unknown> {
    this.calls.push({ method: 'start', payload: page })
    return Promise.resolve(this.page)
  }

  updateImageRawData(data: unknown): Promise<unknown> {
    this.calls.push({ method: 'image', payload: data })
    return Promise.resolve(this.answer)
  }

  textContainerUpgrade(container: unknown): Promise<unknown> {
    this.calls.push({ method: 'words', payload: container })
    return Promise.resolve(true)
  }

  shutDownPageContainer(exitMode?: number): Promise<unknown> {
    this.calls.push({ method: 'leave', payload: exitMode })
    return Promise.resolve(true)
  }

  onEvenHubEvent(handler: (event: unknown) => void): () => void {
    this.push = handler
    return () => {
      this.push = () => undefined
    }
  }
}

function put(host: unknown): void {
  ;(globalThis as { EvenAppBridge?: unknown }).EvenAppBridge = host
}

afterEach(() => {
  delete (globalThis as { EvenAppBridge?: unknown }).EvenAppBridge
  channel(false)
  fromSdk.value = null
})

async function heard(events: unknown[]): Promise<Input[]> {
  const host = new Host()
  put(host)
  const glasses = await connectGlasses()
  const got: Input[] = []
  glasses?.listen((input) => got.push(input))
  for (const event of events) host.push(event)

  return got
}

/** Longer than the module ever waits for a channel, so a test can watch it give
 *  up without waiting itself. */
const PAST_WAITING = 12_000

/** The channel the phone app installs into the WebView, which is the thing the
 *  plugin waits for. Separate from the bridge on purpose: on a real launch the
 *  channel lands first and the SDK's own singleton follows it. */
function channel(open: boolean): void {
  const global = globalThis as { flutter_inappwebview?: { callHandler: () => void } }
  if (open) global.flutter_inappwebview = { callHandler: () => undefined }
  else delete global.flutter_inappwebview
}

/** A module of its own, so that the one wait it shares between callers is not
 *  also shared between tests. */
async function freshly(): Promise<typeof import('./sdk')> {
  vi.resetModules()
  return import('./sdk')
}

/** Asks for the glasses on made-up time, optionally opening the channel partway
 *  through, and answers what it settled on. The waiting is the thing under test,
 *  so no test may do any of it. */
async function asking(plan: { opensAt?: number; waits: number }): Promise<unknown> {
  const { connectGlasses: ask } = await freshly()

  vi.useFakeTimers()
  try {
    if (plan.opensAt !== undefined) setTimeout(() => channel(true), plan.opensAt)

    const asked = ask()
    await vi.advanceTimersByTimeAsync(plan.waits)
    return await asked
  } finally {
    vi.useRealTimers()
  }
}

describe('finding the glasses', () => {
  test('answers with nothing in a plain browser', async () => {
    expect(await asking({ waits: PAST_WAITING })).toBeNull()
  })

  test('answers with nothing when what is on the page is not a bridge', async () => {
    put({ createStartUpPageContainer: () => undefined })
    expect(await asking({ waits: PAST_WAITING })).toBeNull()
  })

  test('uses a bridge that is already standing on the page', async () => {
    put(new Host())
    expect(await connectGlasses()).not.toBeNull()
  })

  /** The bug these are about, and the whole reason a packed build drew nothing
   *  while the simulator drew the note perfectly.
   *
   *  The phone app installs its channel into the WebView while the page is
   *  already loading, so it is not there when the plugin's first line runs.
   *  Looking once and giving up meant no glasses for the life of the app, and
   *  nothing said about it. The simulator installs the channel before the page
   *  runs, which is why one look was always enough there. */
  test('waits for a channel that is not on the page yet', async () => {
    fromSdk.value = new Host()

    expect(await asking({ opensAt: 300, waits: 1000 })).not.toBeNull()
  })

  test('gives up on a page that never grows a channel', async () => {
    fromSdk.value = new Host()

    expect(await asking({ waits: PAST_WAITING })).toBeNull()
  })

  test('waits past a channel that takes most of the deadline', async () => {
    fromSdk.value = new Host()

    expect(await asking({ opensAt: 8000, waits: PAST_WAITING })).not.toBeNull()
  })

  test('looks again after a miss rather than remembering it', async () => {
    fromSdk.value = new Host()
    const { connectGlasses: ask } = await freshly()

    vi.useFakeTimers()
    try {
      const missed = ask()
      await vi.advanceTimersByTimeAsync(PAST_WAITING)
      expect(await missed).toBeNull()

      // The channel turns up late, after the plugin had already given up once.
      // A remembered miss would leave the glasses unreachable for good.
      channel(true)
      expect(await ask()).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reading what the glasses send', () => {
  test('reads a single tap that arrives with no type at all', async () => {
    // Protobuf leaves a zero out and a tap is zero, so this is what one really
    // looks like. Reading the default outside the envelope check would turn
    // every other event into a tap; see sdk.ts.
    expect(await heard([{ sysEvent: { eventSource: 1 } }])).toEqual([
      { kind: 'gesture', gesture: 'tap', from: 'right' },
    ])
  })

  test('does not read a scroll or a lifecycle event as a tap', async () => {
    const got = await heard([
      { textEvent: { eventType: 1 } },
      { textEvent: { eventType: 2 } },
      { sysEvent: { eventType: 4 } },
      { audioEvent: { audioPcm: [] } },
      { listEvent: { currentSelectItemIndex: 0 } },
    ])

    expect(got).toEqual([
      { kind: 'gesture', gesture: 'up', from: 'unknown' },
      { kind: 'gesture', gesture: 'down', from: 'unknown' },
      { kind: 'life', life: 'foreground' },
    ])
  })

  test('reads a double press before a single one', async () => {
    expect(await heard([{ sysEvent: { eventType: 3, eventSource: 1 } }])).toEqual([
      { kind: 'gesture', gesture: 'double', from: 'right' },
    ])
  })

  test('says which surface a gesture came off, ring included', async () => {
    const got = await heard([
      { sysEvent: { eventSource: 1 } },
      { sysEvent: { eventSource: 2 } },
      { sysEvent: { eventSource: 3 } },
      { sysEvent: { eventSource: 99 } },
    ])

    expect(got.map((one) => (one.kind === 'gesture' ? one.from : ''))).toEqual([
      'right',
      'ring',
      'left',
      'unknown',
    ])
  })

  test('reads a swipe that came through the system event instead', async () => {
    const got = await heard([{ sysEvent: { eventType: 2, eventSource: 2 } }])
    expect(got).toEqual([{ kind: 'gesture', gesture: 'down', from: 'ring' }])
  })

  test('folds a lifecycle event the firmware sent twice into one', async () => {
    const got = await heard([
      { sysEvent: { eventType: 5 } },
      { sysEvent: { eventType: 5 } },
      { sysEvent: { eventType: 4 } },
    ])

    expect(got).toEqual([
      { kind: 'life', life: 'background' },
      { kind: 'life', life: 'foreground' },
    ])
  })

  test('does not fold two swipes: two swipes are two pages', async () => {
    const got = await heard([{ textEvent: { eventType: 2 } }, { textEvent: { eventType: 2 } }])
    expect(got).toHaveLength(2)
  })

  test('reads both ways out of the app as gone, and only says so once', async () => {
    // A disconnect and a confirmed exit mean the same thing to the plugin, so
    // the two together are one going.
    expect(await heard([{ sysEvent: { eventType: 6 } }])).toEqual([{ kind: 'life', life: 'gone' }])
    expect(await heard([{ sysEvent: { eventType: 7 } }])).toEqual([{ kind: 'life', life: 'gone' }])
    expect(
      await heard([{ sysEvent: { eventType: 6 } }, { sysEvent: { eventType: 7 } }]),
    ).toHaveLength(1)
  })

  test('ignores what is not an event at all', async () => {
    expect(await heard([null, 'nonsense', 42, {}])).toEqual([])
  })
})

describe('what the plugin asks of the glasses', () => {
  test('reads the host’s answer to a page, whichever shape it takes', async () => {
    // Kept as the host's own word rather than a boolean: a page too big for the
    // panel and a page nothing heard are both a dark panel, and only the corner
    // saying which makes a device worth reading.
    for (const [answer, wanted] of [
      [0, 'made'],
      ['success', 'made'],
      [true, 'made'],
      [1, 'invalid'],
      ['invalid', 'invalid'],
      [2, 'oversize'],
      [3, 'outOfMemory'],
      ['outOfMemory', 'outOfMemory'],
      [undefined, 'unknown'],
    ] as const) {
      const host = new Host()
      host.page = answer
      put(host)
      const glasses = await connectGlasses()
      expect(await glasses?.start({}), String(answer)).toBe(wanted)
    }
  })

  test('sends an image as the numbers the host takes best', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()
    expect(await glasses?.image({ id: 11, name: 'nib1' }, new Uint8Array([1, 255, 0]))).toBe('ok')

    expect(host.calls).toEqual([
      {
        method: 'image',
        payload: { containerID: 11, containerName: 'nib1', imageData: [1, 255, 0] },
      },
    ])
  })

  test('tells a failure worth retrying from the one that is not', async () => {
    for (const [answer, wanted] of [
      ['success', 'ok'],
      [0, 'ok'],
      ['imageException', 'again'],
      ['imageToGray4Failed', 'again'],
      ['sendFailed', 'dead'],
      [3, 'dead'],
      [undefined, 'again'],
    ] as const) {
      const host = new Host()
      host.answer = answer
      put(host)
      const glasses = await connectGlasses()
      expect(
        await glasses?.image({ id: 11, name: 'nib1' }, new Uint8Array(1)),
        String(answer),
      ).toBe(wanted)
    }
  })

  test('asks the glasses to put their own question up on the way out', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()
    await glasses?.leave()

    // Mode 1, not 0: the system asks, rather than the app closing itself. Every
    // app is checked for this on its root page.
    expect(host.calls).toEqual([{ method: 'leave', payload: 1 }])
  })
})

/** The phone app's own store, which is where a packed plugin's session token
 *  outlives a launch. See vault.ts. */
describe('what the phone app keeps', () => {
  /** A host with a store, which the glasses-only stand-in above does not have. */
  class Keeper extends Host {
    readonly held = new Map<string, string>()

    getLocalStorage(key: string): Promise<unknown> {
      // An absent key comes back as the empty string, which is what the real
      // host does and the reason `read` cannot just pass it through.
      return Promise.resolve(this.held.get(key) ?? '')
    }

    setLocalStorage(key: string, value: string): Promise<unknown> {
      this.held.set(key, value)
      return Promise.resolve(true)
    }
  }

  test('answers with no store when the bridge has none', async () => {
    put(new Host())
    expect(await connectStore()).toBeNull()
  })

  test('writes a value and reads it back', async () => {
    const host = new Keeper()
    put(host)

    const store = await connectStore()
    await store?.write('nib:session', 'token')

    expect(host.held.get('nib:session')).toBe('token')
    expect(await store?.read('nib:session')).toBe('token')
  })

  test('reads a key that was never written as nothing, not as an empty token', async () => {
    put(new Keeper())
    expect(await (await connectStore())?.read('nib:session')).toBeNull()
  })

  test('reads a cleared key as nothing, because the host cannot take one away', async () => {
    const host = new Keeper()
    put(host)

    const store = await connectStore()
    await store?.write('nib:session', 'token')
    await store?.write('nib:session', '')

    expect(await store?.read('nib:session')).toBeNull()
  })
})
