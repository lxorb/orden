import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { connectGlasses, connectStore, type Input } from './sdk'

const fromSdk = vi.hoisted((): { value: unknown } => ({ value: null }))

vi.mock('@evenrealities/even_hub_sdk', () => ({
  waitForEvenAppBridge: () => Promise.resolve(fromSdk.value),
}))

class Host {
  readonly calls: { method: string; payload: unknown }[] = []
  push: (event: unknown) => void = () => undefined
  answer: unknown = true
  page: unknown = 0

  createStartUpPageContainer(page: unknown): Promise<unknown> {
    this.calls.push({ method: 'start', payload: page })
    return Promise.resolve(this.page)
  }

  rebuildPageContainer(page: unknown): Promise<unknown> {
    this.calls.push({ method: 'rebuild', payload: page })
    return Promise.resolve(this.answer)
  }

  audioControl(open: boolean, source?: string): Promise<unknown> {
    this.calls.push({ method: 'microphone', payload: { open, source } })
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

const PAST_WAITING = 12_000

function channel(open: boolean): void {
  const global = globalThis as { flutter_inappwebview?: { callHandler: () => void } }
  if (open) global.flutter_inappwebview = { callHandler: () => undefined }
  else delete global.flutter_inappwebview
}

beforeAll(async () => {
  await import('./sdk')
})

async function freshly(): Promise<typeof import('./sdk')> {
  vi.useRealTimers()
  vi.resetModules()
  return import('./sdk')
}

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

  test('does not take a ready SDK for a phone app', async () => {
    fromSdk.value = new Host()

    expect(await asking({ waits: PAST_WAITING })).toBeNull()
  })

  test('looks again after a miss rather than remembering it', async () => {
    fromSdk.value = new Host()
    const { connectGlasses: ask } = await freshly()

    vi.useFakeTimers()
    try {
      const missed = ask()
      await vi.advanceTimersByTimeAsync(PAST_WAITING)
      expect(await missed).toBeNull()

      channel(true)
      expect(await ask()).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reading what the glasses send', () => {
  test('reads a single tap that arrives with no type at all', async () => {
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

  test('rebuilds the page, which is how the line numbers get a column', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()

    expect(await glasses?.rebuild({ containerTotalNum: 1 })).toBe(true)
    expect(host.calls).toEqual([{ method: 'rebuild', payload: { containerTotalNum: 1 } }])
  })

  test('takes the host at its word about a rebuild, in any of its three shapes', async () => {
    for (const [answer, wanted] of [
      [true, true],
      [0, true],
      ['success', true],
      [false, false],
      [undefined, false],
    ] as const) {
      const host = new Host()
      host.answer = answer
      put(host)
      const glasses = await connectGlasses()
      expect(await glasses?.rebuild({}), String(answer)).toBe(wanted)
    }
  })

  test('opens and closes the glasses own microphone', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()

    expect(await glasses?.microphone(true)).toBe(true)
    await glasses?.microphone(false)

    expect(host.calls).toEqual([
      { method: 'microphone', payload: { open: true, source: 'glasses' } },
      { method: 'microphone', payload: { open: false, source: 'glasses' } },
    ])
  })

  test('reads a frame of sound in any of the three shapes a host sends it', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()
    const heard: number[][] = []
    glasses?.listen((input) => {
      if (input.kind === 'audio') heard.push([...input.pcm])
    })

    host.push({ audioEvent: { audioPcm: new Uint8Array([1, 2, 3]) } })
    host.push({ audioEvent: { audioPcm: [4, 5, 6] } })
    host.push({ audioEvent: { audioPcm: 'BwgJ' } })

    expect(heard).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])
  })

  test('never reads a frame of sound as a tap', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()
    const seen: string[] = []
    glasses?.listen((input) => void seen.push(input.kind))

    host.push({ audioEvent: { audioPcm: [1, 2] } })

    expect(seen).toEqual(['audio'])
  })

  test('asks the glasses to put their own question up on the way out', async () => {
    const host = new Host()
    put(host)
    const glasses = await connectGlasses()
    await glasses?.leave()

    expect(host.calls).toEqual([{ method: 'leave', payload: 1 }])
  })
})

describe('what the phone app keeps', () => {
  class Keeper extends Host {
    readonly held = new Map<string, string>()

    getLocalStorage(key: string): Promise<unknown> {
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
