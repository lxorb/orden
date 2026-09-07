import { afterEach, describe, expect, test } from 'vitest'
import { connectGlasses, type Input } from './sdk'

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

describe('finding the glasses', () => {
  test('answers with nothing in a plain browser', async () => {
    expect(await connectGlasses()).toBeNull()
  })

  test('answers with nothing when what is on the page is not a bridge', async () => {
    put({ createStartUpPageContainer: () => undefined })
    expect(await connectGlasses()).toBeNull()
  })

  test('uses a bridge that is already standing on the page', async () => {
    put(new Host())
    expect(await connectGlasses()).not.toBeNull()
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
    for (const [answer, wanted] of [
      [0, true],
      ['success', true],
      [1, false],
      [3, false],
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
