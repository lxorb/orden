import {
  type AppFile,
  appFileOf,
  appSocketPath,
  type AppState,
  type NotStarted,
  UNKNOWN_APP,
  type View,
} from '@orden/online/apps'
import { account } from '../account.svelte'
import { BASE } from '../api'
import { pageWorld } from '../online/link'
import type { Holder } from '../online/arrival.svelte'
import type { IdAt } from '../sync2/runner.svelte'
import { untrack } from 'svelte'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { type AppHeard, AppLink } from './link'
import { Picture } from './picture.svelte'

const WAIT = 20_000
const LOOK_EVERY = 100
const LOOK_WITHIN = 10_000
export const OPEN_DEADLINE = 12_000
export const ANSWER_WITHIN = 15_000
const LOOK_AGAIN = [3_000, 5_000, 10_000, 30_000] as const

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

export type Look = 'open' | 'unserved' | 'unknown' | 'signed-out' | 'unreachable'

export function lookOf(status: number | null, error: unknown): Look {
  if (status === 426) return 'open'
  if (status === 401) return 'signed-out'
  if (status === 404) return error === UNKNOWN_APP ? 'unknown' : 'unserved'
  return 'unreachable'
}

export type AppStatus =
  | { is: 'reading' }
  | { is: 'damaged' }
  | { is: 'signed-out' }
  | { is: 'syncing' }
  | { is: 'unsynced' }
  | { is: Unfound }
  | { is: 'shared' }
  | { is: 'unserved' }
  | { is: 'connecting' }
  | { is: 'unreachable' }
  | { is: 'gone' }
  | { is: 'away' }
  | { is: 'held'; holder: Holder }
  | {
      is: 'here'
      state: AppState | null
      code: number | null
      why: NotStarted | null
      unanswered: boolean
    }

type Blocked =
  'signed-out' | 'syncing' | 'unsynced' | 'unserved' | 'unreachable' | Unfound | 'shared'

export type Found = IdAt | { none: 'old-sync' }

type Unfound = Extract<Found, { none: string }>['none']

interface Device {
  id: string
  name: string
  platform?: string
}

export interface Linked {
  open(): void
  close(): void
  say(frame: Parameters<AppLink['say']>[0]): boolean
  take(): boolean
  resize(view: View): void
}

export interface SessionWorld {
  read(path: string): Promise<string | null>
  find(path: string, until: number): Promise<Found>
  token(): string | null
  devices(token: string): Promise<Device[] | null>
  look(app: string, token: string): Promise<Look>
  link(app: string, heard: (what: AppHeard) => void, view: View): Linked
  after(ms: number, run: () => void): () => void
  now(): number
}

const sessionWorld: SessionWorld = {
  async read(path) {
    const { invoke } = await import('../tauri')
    return invoke<string>('read_note', { path }).catch(() => null)
  },
  find: (path, until) => find(path, until),
  token: () => account.accountToken,
  async devices(token) {
    const { request } = await import('../api')
    const listed = await request<{ devices?: Device[] }>('/v2/devices', { token }).catch(() => null)
    return listed?.devices ?? null
  },
  async look(app, token) {
    const answer = await fetch(`${BASE}${appSocketPath(app)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOK_WITHIN),
    }).catch(() => null)
    if (!answer) return 'unreachable'
    const body: unknown = await answer.json().catch(() => null)
    const error =
      typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
    return lookOf(answer.status, error)
  },
  link(app, heard, view) {
    return new AppLink(
      app,
      pageWorld(
        BASE,
        () => account.accountToken,
        async () => {
          const { deviceId } = await import('../sync2/hub.svelte')
          return deviceId()
        },
      ),
      heard,
      view,
    )
  },
  after(ms, run) {
    const timer = setTimeout(run, ms)
    return () => {
      clearTimeout(timer)
    }
  },
  now: () => Date.now(),
}

export class AppSession {
  file = $state<AppFile | null>(null)
  hostName = $state('')
  hostPlatform = $state('')
  private damaged = $state(false)
  private blocked = $state<Blocked | null>(null)
  private slow = $state(false)
  private hostListed = $state<boolean | null>(null)
  private open = $state(false)
  private hostUp = $state(false)
  private holder = $state<Holder | null>(null)
  private state = $state<AppState | null>(null)
  private code = $state<number | null>(null)
  private why = $state<NotStarted | null>(null)
  private unanswered = $state(false)
  private holding = false
  private link: Linked | null = null
  private ended = false
  private begun = false
  private id: string | null = null
  private view: View | null = null
  private turn = 0
  private tries = 0
  private cancelLook: (() => void) | null = null
  private cancelSlow: (() => void) | null = null
  private cancelAnswer: (() => void) | null = null
  readonly picture = new Picture((data) => {
    this.link?.say({ t: 'signal', data })
  })

  constructor(
    private readonly tab: Tab,
    private readonly world: SessionWorld = sessionWorld,
  ) {}

  get holds(): boolean {
    return this.holding && this.holder === null && this.open
  }

  get status(): AppStatus {
    if (this.damaged) return { is: 'damaged' }
    if (!this.file) return { is: 'reading' }
    if (this.blocked) return { is: this.blocked }
    if (!this.open) return this.slow ? { is: 'unreachable' } : { is: 'connecting' }
    if (this.holder) return { is: 'held', holder: this.holder }
    if (!this.hostUp) return this.hostListed === false ? { is: 'gone' } : { is: 'away' }
    return {
      is: 'here',
      state: this.state,
      code: this.code,
      why: this.why,
      unanswered: this.unanswered,
    }
  }

  async start(view: View): Promise<void> {
    if (this.begun || this.ended) return
    this.begun = true
    this.view = view
    const path = this.tab.path
    if (!path) return
    const text = await this.world.read(path)
    const file = text === null ? null : appFileOf(text)
    if (!file) {
      this.damaged = true
      return
    }
    this.file = file
    void this.nameHost(file.host)
    await this.connect()
  }

  private async connect(): Promise<void> {
    const path = this.tab.path
    const turn = ++this.turn
    if (!path || this.ended) return
    if (!this.world.token()) {
      this.blocked = 'signed-out'
      return
    }
    if (!this.id) {
      if (this.blocked === null || this.blocked === 'signed-out') this.blocked = 'syncing'
      const found = await this.world.find(path, this.world.now() + WAIT)
      if (turn !== this.turn || this.over()) return
      if ('none' in found) {
        this.blocked = found.none
        this.later(turn, () => void this.connect())
        return
      }
      if (!found.own) {
        this.blocked = 'shared'
        return
      }
      this.id = found.id
    }
    await this.lookIn(turn)
  }

  private async lookIn(turn: number): Promise<void> {
    const token = this.world.token()
    const id = this.id
    if (!id || !token) {
      this.blocked = 'signed-out'
      return
    }
    const look = await this.world.look(id, token)
    if (turn !== this.turn || this.ended) return
    if (look === 'open') {
      this.blocked = null
      this.tries = 0
      if (!this.link) {
        this.link = this.world.link(
          id,
          (heard) => {
            this.heard(heard)
          },
          this.view ?? { width: 1, height: 1, dpr: 1, hz: 60 },
        )
        this.link.open()
      }
      this.deadline()
      return
    }
    this.closeLink()
    if (look === 'unknown') this.blocked = 'unsynced'
    else this.blocked = look
    if (look === 'unknown' || look === 'unreachable') this.later(turn, () => void this.lookIn(turn))
  }

  private later(turn: number, again: () => void): void {
    this.cancelLook?.()
    const wait = LOOK_AGAIN[Math.min(this.tries, LOOK_AGAIN.length - 1)] ?? 30_000
    this.tries += 1
    this.cancelLook = this.world.after(wait, () => {
      this.cancelLook = null
      if (turn === this.turn) again()
    })
  }

  private deadline(): void {
    this.cancelSlow?.()
    const turn = this.turn
    this.cancelSlow = this.world.after(OPEN_DEADLINE, () => {
      this.cancelSlow = null
      if (turn !== this.turn || this.open || this.ended) return
      this.slow = true
      void this.lookIn(turn)
    })
  }

  retry(): void {
    if (this.ended || !this.file) return
    this.cancelLook?.()
    this.cancelLook = null
    this.tries = 0
    this.slow = false
    this.blocked = null
    this.closeLink()
    if (this.hostListed === null) void this.nameHost(this.file.host)
    void this.connect()
  }

  private closeLink(): void {
    this.cancelSlow?.()
    this.cancelSlow = null
    this.link?.close()
    this.link = null
    this.open = false
    this.holder = null
  }

  private heard(what: AppHeard): void {
    this.hear(what)
    this.picture.want(!this.ended && this.holding && this.hostUp && this.state === 'running')
  }

  private hear(what: AppHeard): void {
    switch (what.t) {
      case 'open':
        this.open = true
        this.slow = false
        this.cancelSlow?.()
        this.cancelSlow = null
        return
      case 'dropped':
        this.open = false
        this.holder = null
        this.deadline()
        return
      case 'held':
        this.holder = { by: what.by, since: what.since, taken: what.taken }
        this.holding = false
        return
      case 'hold':
        this.holder = null
        this.holding = true
        return
      case 'host':
        this.hostUp = what.up
        return
      case 'state':
        this.state = what.state
        this.code = what.code ?? null
        this.why = what.why ?? null
        this.unanswered = false
        this.cancelAnswer?.()
        this.cancelAnswer = null
        return
      case 'signal':
        this.picture.heard(what.data)
        return
      case 'refused':
        return
    }
  }

  private async nameHost(host: string): Promise<void> {
    const token = this.world.token()
    if (!token) return
    const listed = await this.world.devices(token)
    if (!listed) return
    const found = listed.find((one) => one.id === host)
    this.hostName = found?.name ?? ''
    this.hostPlatform = found?.platform ?? ''
    this.hostListed = found !== undefined
  }

  private over(): boolean {
    return this.ended
  }

  take(): void {
    this.link?.take()
  }

  run(what: 'start' | 'stop' | 'restart'): void {
    if (!this.link?.say({ t: 'run', what })) return
    this.unanswered = false
    this.cancelAnswer?.()
    this.cancelAnswer = this.world.after(ANSWER_WITHIN, () => {
      this.cancelAnswer = null
      this.unanswered = true
    })
  }

  resize(view: View): void {
    this.view = view
    this.link?.resize(view)
  }

  end(): void {
    this.ended = true
    this.turn += 1
    this.cancelLook?.()
    this.cancelAnswer?.()
    this.picture.end()
    this.closeLink()
  }
}

function onOldSync(): boolean {
  return !!account.user && account.user.syncVersion !== 2
}

export async function find(path: string, until: number): Promise<Found> {
  if (onOldSync()) {
    await account.reread()
    if (onOldSync()) return { none: 'old-sync' }
  }
  const { runner } = await import('../sync2/runner.svelte')
  for (;;) {
    const found = await runner.idAt(path)
    if ('id' in found || Date.now() >= until) return found
    await pause(LOOK_EVERY)
  }
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
const sessions = new Map<string, AppSession>()
let watching = false

export function appSessionIfAny(tab: Tab): AppSession | null {
  return sessions.get(tab.id) ?? null
}

export function appSessionOf(tab: Tab): AppSession {
  if (!watching) {
    watching = true
    $effect.root(() => {
      $effect(() => {
        const open = workspace.tabs.map((one) => one.id)
        untrack(() => {
          for (const [id, one] of sessions) {
            if (open.includes(id)) continue
            sessions.delete(id)
            one.end()
          }
        })
      })
    })
  }
  let session = sessions.get(tab.id)
  if (!session) {
    session = new AppSession(tab)
    sessions.set(tab.id, session)
  }
  return session
}
