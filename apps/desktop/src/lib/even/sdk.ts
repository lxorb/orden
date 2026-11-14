import { waited } from '../platform/src/api'

const CLICK = 0
const SCROLL_TOP = 1
const SCROLL_BOTTOM = 2
const DOUBLE_CLICK = 3
const FOREGROUND_ENTER = 4
const FOREGROUND_EXIT = 5
const ABNORMAL_EXIT = 6
const SYSTEM_EXIT = 7
const LONG_PRESS = 9

const FROM_RIGHT = 1
const FROM_RING = 2
const FROM_LEFT = 3

type Gesture = 'up' | 'down' | 'tap' | 'double' | 'hold'
type Source = 'ring' | 'left' | 'right' | 'unknown'
type Life = 'foreground' | 'background' | 'gone'

export type Input =
  | { kind: 'gesture'; gesture: Gesture; from: Source }
  | { kind: 'life'; life: Life }
  | { kind: 'audio'; pcm: Uint8Array }

export interface Container {
  id: number
  name: string
}

export type Made = 'made' | 'invalid' | 'oversize' | 'outOfMemory' | 'unknown'

export interface Glasses {
  start(page: unknown): Promise<Made>
  rebuild(page: unknown): Promise<boolean>
  words(container: Container, content: string): Promise<boolean>
  listen(handler: (input: Input) => void): () => void
  microphone(open: boolean): Promise<boolean>
  leave(): Promise<void>
}

export interface Store {
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<boolean>
}

interface Bridge {
  createStartUpPageContainer(page: unknown): Promise<unknown>
  rebuildPageContainer(page: unknown): Promise<unknown>
  textContainerUpgrade(container: unknown): Promise<unknown>
  audioControl(open: boolean, source?: string): Promise<unknown>
  shutDownPageContainer(exitMode?: number): Promise<unknown>
  onEvenHubEvent(handler: (event: unknown) => void): () => void
}

interface Keeper {
  getLocalStorage(key: string): Promise<unknown>
  setLocalStorage(key: string, value: string): Promise<unknown>
}

const METHODS = [
  'createStartUpPageContainer',
  'rebuildPageContainer',
  'textContainerUpgrade',
  'audioControl',
  'shutDownPageContainer',
  'onEvenHubEvent',
] as const

function isBridge(value: unknown): value is Bridge {
  if (typeof value !== 'object' || value === null) return false

  const one = value as Record<string, unknown>
  return METHODS.every((method) => typeof one[method] === 'function')
}

function hosted(): boolean {
  const host = (globalThis as { flutter_inappwebview?: { callHandler?: unknown } })
    .flutter_inappwebview
  return typeof host?.callHandler === 'function'
}

const HOST_WAIT = 10_000
const HOST_LOOK = 50

const READY = 'flutterInAppWebViewPlatformReady'

export const PATIENCE = 8_000

export const SILENT = 'the glasses did not answer in time'

function answered<T>(asked: () => Promise<T>, otherwise: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        resolve(otherwise())
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }, PATIENCE)

    Promise.resolve()
      .then(asked)
      .then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
  })
}

function heard<T>(asked: () => Promise<T>, otherwise: () => T): Promise<T> {
  return answered(asked, otherwise).catch(otherwise)
}

function silent(): never {
  throw new Error(SILENT)
}

async function waitForHost(): Promise<boolean> {
  if (hosted()) return true

  let announced = (): void => undefined
  const said = new Promise<void>((resolve) => {
    announced = () => {
      resolve()
    }
  })

  const listens = typeof globalThis.addEventListener === 'function'
  if (listens) globalThis.addEventListener(READY, announced)

  try {
    const until = Date.now() + HOST_WAIT
    while (!hosted()) {
      if (Date.now() >= until) return false
      await Promise.race([said, waited(HOST_LOOK)])
    }

    return true
  } finally {
    if (listens) globalThis.removeEventListener(READY, announced)
  }
}

function standing(): Bridge | null {
  const found = (globalThis as { EvenAppBridge?: unknown }).EvenAppBridge
  return isBridge(found) ? found : null
}

let connecting: Promise<Bridge | null> | null = null

async function connect(): Promise<Bridge | null> {
  const already = standing()
  if (already) return already

  connecting ??= reach()
  const bridge = await connecting

  if (!bridge) connecting = null
  return bridge
}

async function reach(): Promise<Bridge | null> {
  if (!(await waitForHost())) return null

  const sdk = await import('@evenrealities/even_hub_sdk')
  const bridge = await sdk.waitForEvenAppBridge()

  return isBridge(bridge) ? bridge : null
}

export async function connectGlasses(): Promise<Glasses | null> {
  const bridge = await connect()
  return bridge ? glassesOf(bridge) : null
}

function keeps(value: unknown): value is Keeper {
  if (typeof value !== 'object' || value === null) return false

  const one = value as Record<string, unknown>
  return typeof one.getLocalStorage === 'function' && typeof one.setLocalStorage === 'function'
}

export async function connectStore(): Promise<Store | null> {
  const bridge = await connect()
  if (!keeps(bridge)) return null

  return {
    async read(key) {
      const found = await answered(
        () => bridge.getLocalStorage(key),
        () => null,
      )
      return typeof found === 'string' && found !== '' ? found : null
    },

    async write(key, value) {
      const answer = await answered(
        () => bridge.setLocalStorage(key, value),
        () => false,
      )
      return answer === true || answer === 0 || answer === 'success'
    },
  }
}

function madeOf(answer: unknown): Made {
  if (answer === 0 || answer === 'success' || answer === true) return 'made'

  const word = typeof answer === 'number' ? String(answer) : answer
  switch (word) {
    case '1':
    case 'invalid':
      return 'invalid'
    case '2':
    case 'oversize':
      return 'oversize'
    case '3':
    case 'outOfMemory':
      return 'outOfMemory'
    default:
      return 'unknown'
  }
}

function pcmOf(found: unknown): Uint8Array | null {
  if (found instanceof Uint8Array) return found.length ? found : null
  if (Array.isArray(found)) {
    return found.length ? Uint8Array.from(found.map((one) => Number(one) & 0xff)) : null
  }

  if (typeof found === 'string' && found !== '') {
    try {
      const raw = atob(found)
      const out = new Uint8Array(raw.length)
      for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
      return out
    } catch {
      return null
    }
  }

  return null
}

function sourceOf(from: unknown): Source {
  switch (from) {
    case FROM_RING:
      return 'ring'
    case FROM_LEFT:
      return 'left'
    case FROM_RIGHT:
      return 'right'
    default:
      return 'unknown'
  }
}

function typeOf(envelope: unknown): number | null {
  if (typeof envelope !== 'object' || envelope === null) return null

  const found = (envelope as { eventType?: unknown }).eventType
  return typeof found === 'number' ? found : CLICK
}

function sourceIn(envelope: unknown): Source {
  if (typeof envelope !== 'object' || envelope === null) return 'unknown'
  return sourceOf((envelope as { eventSource?: unknown }).eventSource)
}

const SAME_LIFE = 600

function inputOf(event: Record<string, unknown>): Input | null {
  const audio = event.audioEvent
  if (typeof audio === 'object' && audio !== null) {
    const pcm = pcmOf((audio as { audioPcm?: unknown }).audioPcm)
    return pcm ? { kind: 'audio', pcm } : null
  }

  const text = typeOf(event.textEvent)
  if (text === SCROLL_TOP) return { kind: 'gesture', gesture: 'up', from: 'unknown' }
  if (text === SCROLL_BOTTOM) return { kind: 'gesture', gesture: 'down', from: 'unknown' }

  const sys = typeOf(event.sysEvent)
  if (sys === null) return null

  const from = sourceIn(event.sysEvent)
  switch (sys) {
    case DOUBLE_CLICK:
      return { kind: 'gesture', gesture: 'double', from }
    case LONG_PRESS:
      return { kind: 'gesture', gesture: 'hold', from }
    case CLICK:
      return { kind: 'gesture', gesture: 'tap', from }
    case SCROLL_TOP:
      return { kind: 'gesture', gesture: 'up', from }
    case SCROLL_BOTTOM:
      return { kind: 'gesture', gesture: 'down', from }
    case FOREGROUND_ENTER:
      return { kind: 'life', life: 'foreground' }
    case FOREGROUND_EXIT:
      return { kind: 'life', life: 'background' }
    case ABNORMAL_EXIT:
    case SYSTEM_EXIT:
      return { kind: 'life', life: 'gone' }
    default:
      return null
  }
}

function glassesOf(bridge: Bridge): Glasses {
  let lastLife: { life: Life; at: number } | null = null

  return {
    async start(page) {
      return madeOf(
        await answered(
          () => bridge.createStartUpPageContainer(page),
          () => 'unknown',
        ),
      )
    },

    async rebuild(page) {
      const answer = await heard(
        () => bridge.rebuildPageContainer(page),
        () => false,
      )
      return answer === true || answer === 0 || answer === 'success'
    },

    async words(container, content) {
      const answer = await answered(
        () =>
          bridge.textContainerUpgrade({
            containerID: container.id,
            containerName: container.name,
            content,
          }),
        silent,
      )
      return answer === true
    },

    async microphone(open) {
      const answer = await heard(
        () => bridge.audioControl(open, 'glasses'),
        () => false,
      )
      return answer === true || answer === 0 || answer === 'success'
    },

    listen(handler) {
      return bridge.onEvenHubEvent((event) => {
        if (typeof event !== 'object' || event === null) return

        const one = event as Record<string, unknown>
        const input = inputOf(one)
        if (!input) return

        if (input.kind === 'life') {
          const now = Date.now()
          if (lastLife?.life === input.life && now - lastLife.at < SAME_LIFE) return

          lastLife = { life: input.life, at: now }
        }

        handler(input)
      })
    },

    async leave() {
      await heard(
        () => bridge.shutDownPageContainer(1),
        () => undefined,
      )
    },
  }
}
