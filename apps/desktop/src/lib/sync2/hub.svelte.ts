import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { BASE } from '../api'
import { BEAT_EVERY, roomDelay } from '../backoff'
import { t } from '../i18n.svelte'
import { heldForLife } from '../locks'
import { madeDeviceId } from './made-device'
import { invoke, isDesktop, platform } from '../tauri'
import {
  BEAT,
  DEVICE,
  readHubFrame,
  type FromDevice,
  type FromHub,
  type HubFrame,
  type HubType,
} from './hub-frames'

export type HubState = 'off' | 'connecting' | 'open'

const ENDED = 1008

const OPEN_WITHIN = 10_000

const SILENT_BEATS = 3

export interface HubSocket {
  readonly open: boolean
  send(text: string): void
  close(): void
}

export interface SocketEvents {
  opened(): void
  heard(text: string): void
  closed(code: number): void
}

export interface HubChannel {
  post(message: unknown): void
}

export interface HubWorld {
  socket(url: string, protocols: string[], events: SocketEvents): HubSocket
  device(): Promise<string>
  name(): Promise<string>
  channel(heard: (message: unknown) => void): HubChannel | null
  elect(lead: () => void): void
  every(ms: number, tick: () => void): () => void
}

type Relayed =
  | { k: 'frame'; frame: FromHub }
  | { k: 'state'; state: HubState }
  | { k: 'opened' }
  | { k: 'send'; frame: FromDevice }
  | { k: 'ask' }

type Listener = (frame: FromHub) => void

export class Hub {
  state = $state<HubState>('off')
  device: string | null = null

  private token: string | null = null
  private socket: HubSocket | null = null
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private stopBeat: (() => void) | null = null
  private opening: ReturnType<typeof setTimeout> | undefined
  private quiet = 0
  private leading = false
  private electing = false
  private channel: HubChannel | null = null
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is listening; nothing renders from it
  private readonly listeners = new Map<HubType, Set<Listener>>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly openers = new Set<() => void>()

  constructor(private readonly world: HubWorld) {}

  start(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const token = account.signedIn ? account.token : null
        untrack(() => this.follow(token))
      })
    })
  }

  follow(token: string | null): void {
    if (token === this.token) return
    this.token = token
    this.join()

    if (!this.leading) {
      this.elect()
      return
    }
    this.drop()
    if (token) this.connect()
  }

  on<T extends HubType>(type: T, listener: (frame: HubFrame<T>) => void): () => void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
    const all = this.listeners.get(type) ?? new Set<Listener>()
    this.listeners.set(type, all)
    const one = listener as Listener
    all.add(one)
    return () => all.delete(one)
  }

  opened(run: () => void): () => void {
    this.openers.add(run)
    return () => this.openers.delete(run)
  }

  get leads(): boolean {
    return this.leading
  }

  send(frame: FromDevice): boolean {
    if (this.state !== 'open') return false
    if (!this.leading) {
      this.channel?.post({ k: 'send', frame } satisfies Relayed)
      return true
    }
    return this.write(JSON.stringify(frame))
  }

  private join(): void {
    if (this.channel) return
    this.channel = this.world.channel((message) => {
      this.relayed(message as Relayed)
    })
  }

  private elect(): void {
    if (this.electing) return
    this.electing = true
    this.world.elect(() => {
      this.leading = true
      if (this.token) this.connect()
    })
    this.channel?.post({ k: 'ask' } satisfies Relayed)
  }

  private relayed(said: Relayed): void {
    if (this.leading) {
      if (said.k === 'send' && this.state === 'open') this.write(JSON.stringify(said.frame))
      if (said.k === 'ask') this.channel?.post({ k: 'state', state: this.state } satisfies Relayed)
      return
    }

    if (said.k === 'frame') this.hear(said.frame)
    else if (said.k === 'state') this.state = said.state
    else if (said.k === 'opened') {
      this.state = 'open'
      this.announce()
    }
  }

  private connect(): void {
    const token = this.token
    if (!token || this.socket) return
    this.setState('connecting')

    void this.world.device().then(
      (device) => {
        if (this.token !== token || this.socket) return
        this.device = device
        this.open(token, device)
      },
      () => {
        this.again()
      },
    )
  }

  private open(token: string, device: string): void {
    const url = `${BASE.replace(/^http/, 'ws')}/v2/hub`
    let socket: HubSocket | null = null
    try {
      socket = this.world.socket(url, [`nib.token.${token}`, `nib.device.${device}`], {
        opened: () => {
          clearTimeout(this.opening)
          this.tries = 0
          this.quiet = 0
          void this.hello()
          this.stopBeat?.()
          this.stopBeat = this.world.every(BEAT_EVERY, () => this.beat(socket))
        },
        heard: (text) => {
          if (this.socket === socket) this.quiet = 0
          const frame = readHubFrame(text)
          if (!frame) return
          this.hear(frame)
          this.channel?.post({ k: 'frame', frame } satisfies Relayed)
        },
        closed: (code) => {
          if (this.socket !== socket) return
          this.lost(null)
          if (code !== ENDED) this.again()
        },
      })
    } catch {
      this.again()
      return
    }
    this.socket = socket
    const made = socket
    clearTimeout(this.opening)
    this.opening = setTimeout(() => {
      if (this.socket === made && !made.open) {
        this.lost(made)
        this.again()
      }
    }, OPEN_WITHIN)
  }

  private beat(socket: HubSocket | null): void {
    if (!socket || this.socket !== socket) return
    this.quiet += 1
    if (this.quiet >= SILENT_BEATS) {
      this.lost(socket)
      this.again()
      return
    }
    this.write(BEAT)
  }

  private lost(socket: HubSocket | null): void {
    clearTimeout(this.opening)
    this.opening = undefined
    this.socket = null
    this.stopBeat?.()
    this.stopBeat = null
    socket?.close()
    this.setState('off')
  }

  private async hello(): Promise<void> {
    const device = this.device
    if (!device) return

    const name = await this.world.name().catch(() => '')
    const sent = this.write(
      JSON.stringify({
        t: 'hello',
        device,
        name: name || platform() || 'nib',
        platform: platform() || 'web',
        app: __APP_VERSION__,
      } satisfies FromDevice),
    )
    if (!sent) return

    this.setState('open')
    this.channel?.post({ k: 'opened' } satisfies Relayed)
    this.announce()
  }

  private announce(): void {
    for (const run of this.openers) run()
  }

  private hear(frame: FromHub): void {
    for (const listener of this.listeners.get(frame.t) ?? []) listener(frame)
  }

  private write(text: string): boolean {
    const socket = this.socket
    if (!socket?.open) return false
    try {
      socket.send(text)
      return true
    } catch {
      return false
    }
  }

  private setState(state: HubState): void {
    this.state = state
    this.channel?.post({ k: 'state', state } satisfies Relayed)
  }

  private again(): void {
    if (!this.token || this.retry) return
    this.tries++
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, roomDelay(this.tries))
  }

  private drop(): void {
    clearTimeout(this.retry)
    this.retry = undefined
    this.tries = 0
    this.lost(this.socket)
  }
}

export async function deviceId(): Promise<string> {
  const user = account.user
  if (user && !__EVEN_PLUGIN__) {
    const { runner } = await import('./runner.svelte')
    const device = await runner.deviceOf(user.id).catch(() => null)
    if (device && DEVICE.test(device)) return device
    return madeDeviceId(user.id)
  }
  return madeDeviceId(null)
}

async function deviceName(): Promise<string> {
  if (isDesktop) {
    const named = await invoke<unknown>('device_name').catch(() => null)
    if (typeof named === 'string' && named.trim()) return named.trim()
  }
  const { deviceName: platformName } = await import('../rooms/who')
  return platformName(t('Browser'))
}

function ticking(ms: number, tick: () => void): () => void {
  if (typeof Worker === 'function' && typeof URL.createObjectURL === 'function') {
    try {
      const source = `setInterval(() => postMessage(0), ${String(ms)})`
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const worker = new Worker(url)
      URL.revokeObjectURL(url)
      worker.onmessage = tick
      return () => worker.terminate()
    } catch {
      // A policy that refuses a worker: the page's own clock.
    }
  }
  const timer = setInterval(tick, ms)
  return () => clearInterval(timer)
}

const nativeWorld: HubWorld = {
  socket: (url, protocols, events) => {
    const socket = new WebSocket(url, protocols)
    socket.onopen = () => {
      events.opened()
    }
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') events.heard(event.data)
    }
    socket.onclose = (event) => {
      events.closed(event.code)
    }
    socket.onerror = () => undefined
    return {
      get open() {
        return socket.readyState === WebSocket.OPEN
      },
      send: (text) => {
        socket.send(text)
      },
      close: () => {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      },
    }
  },
  device: deviceId,
  name: deviceName,
  channel: (heard) => {
    if (typeof BroadcastChannel !== 'function') return null
    const channel = new BroadcastChannel('orden:hub')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      heard(event.data)
    }
    return { post: (message) => channel.postMessage(message) }
  },
  elect: (lead) =>
    heldForLife('orden:hub', () => {
      lead()
      return new Promise<never>(() => undefined)
    }),
  every: ticking,
}

export const hub = new Hub(nativeWorld)
