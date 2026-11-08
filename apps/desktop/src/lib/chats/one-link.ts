import type {
  Account,
  ChatProvider,
  Connection,
  Host,
  ProviderEvent,
  Status,
} from '@orden/chats/provider'
import { locksHere, locksWork } from '../locks'

const NEEDED = ['conversations', 'history', 'send', 'attachment'] as const

const MAY = [
  'markRead',
  'thread',
  'edit',
  'remove',
  'react',
  'pin',
  'vote',
  'typing',
  'markUnread',
  'search',
  'members',
  'people',
  'begin',
  'invite',
  'kick',
  'promote',
  'rename',
  'describe',
  'leave',
  'mute',
  'archive',
  'pinConversation',
  'stickers',
  'gifs',
  'stickerBytes',
  'picture',
] as const

type Method = (typeof NEEDED)[number] | (typeof MAY)[number]

const METHODS: readonly Method[] = [...NEEDED, ...MAY]

const TAKE_WITHIN = 10_000

const AGAIN_AFTER = 10_000

export interface Line {
  post(message: unknown): void
  close(): void
}

export interface LinkWorld {
  id: string
  locks(): Promise<LockManager | null>
  line(heard: (message: unknown) => void): Line | null
}

export type Wanted = (account: string) => boolean

export type Dial = (
  provider: ChatProvider,
  config: Readonly<Record<string, string>>,
  host: Host,
  known: string | undefined,
  wanted: Wanted,
) => Promise<Connection>

type Said =
  | { k: 'hello'; key: string; from: string }
  | {
      k: 'here'
      key: string
      to: string | null
      account: Account
      methods: Method[]
      status: Status | null
    }
  | { k: 'call'; key: string; from: string; id: number; method: Method; args: unknown[] }
  | { k: 'answer'; to: string; id: number; ok: boolean; value?: unknown; error?: string }
  | { k: 'event'; key: string; event: ProviderEvent }
  | { k: 'yield'; key: string; from: string }

type Invoke = (...args: unknown[]) => Promise<unknown>

function keyOf(provider: string, account: string): string {
  return `orden:chat-link:${provider}\n${account}`
}

function methodsOf(connection: Connection): Method[] {
  const record = connection as unknown as Record<string, unknown>
  return METHODS.filter((one) => typeof record[one] === 'function')
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSaid(value: unknown): value is Said {
  return typeof value === 'object' && value !== null && typeof (value as Said).k === 'string'
}

interface Asked {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class Held {
  mode: 'lead' | 'follow' | 'shut'
  real: Connection | null = null
  account: Account | null = null
  methods: Method[] = []
  status: Status | null = null
  private hear: ((event: ProviderEvent) => void) | null = null
  private stopReal: (() => void) | null = null
  private release: (() => void) | null = null
  private abort: AbortController | null = null
  private readonly asked = new Map<number, Asked>()
  private asking = 0
  private made: Connection | null = null
  private settle: { resolve: (connection: Connection) => void; reject: (error: Error) => void }
  readonly ready: Promise<Connection>

  constructor(
    private readonly link: OneLink,
    readonly key: string,
    private readonly known: string,
    private readonly provider: ChatProvider,
    private readonly config: Readonly<Record<string, string>>,
    private readonly host: Host,
    private readonly wanted: Wanted,
    private readonly locks: LockManager,
  ) {
    this.mode = 'follow'
    let settle!: Held['settle']
    this.ready = new Promise<Connection>((resolve, reject) => (settle = { resolve, reject }))
    this.settle = settle
  }

  lead(real: Connection, release: () => void): void {
    this.real = real
    this.release = release
    this.mode = 'lead'
    this.took(real.account, methodsOf(real), this.status)
    this.link.post(this.here(null))
  }

  here(to: string | null): Said {
    return {
      k: 'here',
      key: this.key,
      to,
      account: this.account ?? { id: this.known, label: this.known },
      methods: this.methods,
      status: this.status,
    }
  }

  took(account: Account, methods: Method[], status: Status | null): void {
    if (this.made) return
    this.account = account
    this.methods = methods
    this.status = status
    const facade: Record<string, unknown> = {
      start: (hear: (event: ProviderEvent) => void) => this.start(hear),
      close: () => this.close(),
    }
    Object.defineProperty(facade, 'account', { get: () => this.account, enumerable: true })
    for (const method of methods) facade[method] = (...args: unknown[]) => this.call(method, args)
    this.made = facade as unknown as Connection
    this.settle.resolve(this.made)
  }

  wait(): void {
    if (this.mode === 'shut') return
    const abort = new AbortController()
    this.abort = abort
    this.locks
      .request(
        this.key,
        { signal: abort.signal },
        () =>
          new Promise<void>((free) => {
            this.release = free
            void this.promote()
          }),
      )
      .catch(() => undefined)
  }

  private freed(): void {
    const release = this.release
    this.release = null
    release?.()
  }

  private async promote(): Promise<void> {
    if (this.mode !== 'follow' || !this.wanted(this.known)) {
      this.freed()
      return
    }
    let real: Connection
    try {
      real = await this.provider.connect(this.config, this.host, this.known)
    } catch (error) {
      this.freed()
      if (!this.made) {
        this.mode = 'shut'
        this.link.forget(this)
        this.settle.reject(error instanceof Error ? error : new Error(reasonOf(error)))
        return
      }
      this.hear?.({ t: 'status', status: 'offline', reason: reasonOf(error) })
      setTimeout(() => this.wait(), AGAIN_AFTER)
      return
    }
    if (!this.following()) {
      this.freed()
      await real.close().catch(() => undefined)
      return
    }
    this.dropAsked('the connection moved to another window')
    const release = this.release ?? (() => undefined)
    this.lead(real, release)
    if (this.hear) {
      this.hear({ t: 'status', status: 'connecting' })
      this.listen()
    }
  }

  private following(): boolean {
    return this.mode === 'follow'
  }

  demote(): void {
    if (this.mode !== 'lead') return
    this.stopReal?.()
    this.stopReal = null
    const real = this.real
    this.real = null
    this.mode = 'follow'
    this.freed()
    void real?.close().catch(() => undefined)
    this.wait()
  }

  private listen(): void {
    const real = this.real
    if (!real || !this.hear) return
    this.stopReal = real.start((event) => {
      if (event.t === 'status') this.status = event.status
      this.hear?.(event)
      this.link.post({ k: 'event', key: this.key, event })
    })
  }

  private start(hear: (event: ProviderEvent) => void): () => void {
    this.hear = hear
    if (this.mode === 'lead') this.listen()
    else if (this.status) hear({ t: 'status', status: this.status })
    return () => {
      this.hear = null
      this.stopReal?.()
      this.stopReal = null
    }
  }

  heard(event: ProviderEvent): void {
    if (this.mode !== 'follow') return
    if (event.t === 'status') this.status = event.status
    this.hear?.(event)
  }

  answered(said: Extract<Said, { k: 'answer' }>): void {
    const asked = this.asked.get(said.id)
    if (!asked) return
    this.asked.delete(said.id)
    if (said.ok) asked.resolve(said.value)
    else asked.reject(new Error(said.error ?? 'refused'))
  }

  dropAsked(reason: string): void {
    for (const one of this.asked.values()) one.reject(new Error(reason))
    this.asked.clear()
  }

  private call(method: Method, args: unknown[]): Promise<unknown> {
    if (this.mode === 'lead' && this.real) {
      const own = (this.real as unknown as Record<string, Invoke | undefined>)[method]
      return own ? own.apply(this.real, args) : Promise.reject(new Error('not offered'))
    }
    if (this.mode === 'shut') return Promise.reject(new Error('not connected'))
    this.asking += 1
    const id = this.asking
    return new Promise((resolve, reject) => {
      this.asked.set(id, { resolve, reject })
      this.link.post({ k: 'call', key: this.key, from: this.link.id, id, method, args })
    })
  }

  async serve(said: Extract<Said, { k: 'call' }>): Promise<void> {
    const real = this.real
    if (this.mode !== 'lead' || !real) return
    const own = (real as unknown as Record<string, Invoke | undefined>)[said.method]
    try {
      if (!own) throw new Error('not offered')
      const value = await own.apply(real, said.args)
      this.link.post({ k: 'answer', to: said.from, id: said.id, ok: true, value })
    } catch (error) {
      this.link.post({
        k: 'answer',
        to: said.from,
        id: said.id,
        ok: false,
        error: reasonOf(error),
      })
    }
  }

  async close(): Promise<void> {
    const was = this.mode
    this.mode = 'shut'
    this.link.forget(this)
    this.abort?.abort()
    this.dropAsked('not connected')
    this.stopReal?.()
    this.stopReal = null
    const real = this.real
    this.real = null
    this.freed()
    if (was === 'lead') await real?.close()
  }
}

export class OneLink {
  private readonly held = new Map<string, Set<Held>>()
  private line: Line | null | undefined

  constructor(private readonly world: LinkWorld) {}

  get id(): string {
    return this.world.id
  }

  post(said: Said): void {
    this.line?.post(said)
  }

  forget(one: Held): void {
    const all = this.held.get(one.key)
    all?.delete(one)
    if (all?.size === 0) this.held.delete(one.key)
  }

  private keep(one: Held): void {
    const all = this.held.get(one.key) ?? new Set<Held>()
    all.add(one)
    this.held.set(one.key, all)
  }

  private open(): Line | null {
    if (this.line === undefined) this.line = this.world.line((said) => this.heard(said))
    return this.line
  }

  private heard(said: unknown): void {
    if (!isSaid(said)) return
    if (said.k === 'answer') {
      if (said.to !== this.id) return
      for (const all of this.held.values()) for (const one of all) one.answered(said)
      return
    }
    const all = [...(this.held.get(said.key) ?? [])]
    if (said.k === 'hello') {
      for (const one of all) if (one.mode === 'lead') this.post(one.here(said.from))
    } else if (said.k === 'here') {
      if (said.to !== null && said.to !== this.id) return
      for (const one of all) {
        if (one.mode !== 'follow') continue
        if (said.to === null) one.dropAsked('the connection moved to another window')
        one.took(said.account, said.methods, said.status)
      }
    } else if (said.k === 'call') {
      for (const one of all) void one.serve(said)
    } else if (said.k === 'event') {
      for (const one of all) one.heard(said.event)
    } else {
      if (said.from !== this.id) for (const one of all) one.demote()
    }
  }

  async alone<T>(provider: string, account: string, work: () => Promise<T>): Promise<T> {
    const locks = await this.world.locks()
    if (!locks) return work()
    const release = await holdWithin(locks, keyOf(provider, account), TAKE_WITHIN)
    try {
      return await work()
    } finally {
      release()
    }
  }

  async dial(
    provider: ChatProvider,
    config: Readonly<Record<string, string>>,
    host: Host,
    known: string | undefined,
    wanted: Wanted,
  ): Promise<Connection> {
    const locks = await this.world.locks()
    if (!locks || !this.open()) return provider.connect(config, host, known)
    if (known === undefined) return this.signIn(locks, provider, config, host, wanted)
    const key = keyOf(provider.id, known)
    const held = new Held(this, key, known, provider, config, host, wanted, locks)
    this.keep(held)
    const release = await holdIfFree(locks, key)
    if (release) {
      try {
        const real = await provider.connect(config, host, known)
        held.lead(real, release)
      } catch (error) {
        release()
        this.forget(held)
        throw error
      }
      return held.ready
    }
    held.wait()
    this.post({ k: 'hello', key, from: this.id })
    return held.ready
  }

  private async signIn(
    locks: LockManager,
    provider: ChatProvider,
    config: Readonly<Record<string, string>>,
    host: Host,
    wanted: Wanted,
  ): Promise<Connection> {
    const real = await provider.connect(config, host)
    const key = keyOf(provider.id, real.account.id)
    for (const one of [...(this.held.get(key) ?? [])]) one.demote()
    let release = await holdIfFree(locks, key)
    if (!release) {
      this.post({ k: 'yield', key, from: this.id })
      release = await holdWithin(locks, key, TAKE_WITHIN)
    }
    const held = new Held(this, key, real.account.id, provider, config, host, wanted, locks)
    this.keep(held)
    held.lead(real, release)
    return held.ready
  }
}

function holdIfFree(locks: LockManager, key: string): Promise<(() => void) | null> {
  return new Promise((resolve) => {
    locks
      .request(key, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null)
          return undefined
        }
        return new Promise<void>((free) => resolve(() => free()))
      })
      .catch(() => resolve(() => undefined))
  })
}

function holdWithin(locks: LockManager, key: string, within: number): Promise<() => void> {
  return new Promise((resolve) => {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      abort.abort()
      resolve(() => undefined)
    }, within)
    locks
      .request(
        key,
        { signal: abort.signal },
        () =>
          new Promise<void>((free) => {
            clearTimeout(timer)
            resolve(() => free())
          }),
      )
      .catch(() => undefined)
  })
}

const nativeWorld = (): LinkWorld => ({
  id: crypto.randomUUID(),
  async locks() {
    const locks = locksHere()
    return locks && (await locksWork(locks)) ? locks : null
  },
  line(heard) {
    if (typeof BroadcastChannel !== 'function') return null
    const channel = new BroadcastChannel('orden:chat-links')
    channel.onmessage = (event: MessageEvent<unknown>) => heard(event.data)
    return {
      post: (message) => channel.postMessage(message),
      close: () => channel.close(),
    }
  },
})

let native: OneLink | null = null

export const oneLink: Dial = (provider, config, host, known, wanted) => {
  native ??= new OneLink(nativeWorld())
  return native.dial(provider, config, host, known, wanted)
}

export type Alone = <T>(provider: string, account: string, work: () => Promise<T>) => Promise<T>

export const oneAlone: Alone = (provider, account, work) => {
  native ??= new OneLink(nativeWorld())
  return native.alone(provider, account, work)
}
