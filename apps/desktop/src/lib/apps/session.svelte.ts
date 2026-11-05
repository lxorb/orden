/** An application's tab, as it stands (docs/apps.md): which device it runs on, whether
 *  that device is there, where the application is, and who holds it. Kept per tab and
 *  outliving the pane that draws it, as a terminal's session does.
 *
 *  The file says the host and what runs; the account names the relay by the file's id,
 *  never by its words, as an online terminal's. */

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
import { untrack } from 'svelte'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { type AppHeard, AppLink } from './link'
import { Picture } from './picture.svelte'

/** How long a file just made is waited for, for sync to give it its id. */
const WAIT = 20_000
const LOOK_EVERY = 100
/** How long the account has to answer a look before it counts as not reached. */
const LOOK_WITHIN = 10_000
/** How long a socket the account said may open has to open before the tab says it
 *  cannot reach it, and looks again why. */
export const OPEN_DEADLINE = 12_000
/** How long the host has to answer Start, Stop or Restart before the tab says it did not. */
export const ANSWER_WITHIN = 15_000
/** The waits between looks that may come out otherwise later: a file that is still
 *  syncing up, an account that could not be reached. */
const LOOK_AGAIN = [3_000, 5_000, 10_000, 30_000] as const

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

/** What a look at the application's door found (services/sync/src/apps/door.ts): that
 *  its socket may open, or why not - this account serves no applications (an older
 *  server, or the switch off), the file is not on the account (yet), the sign-in
 *  ended, or the account did not answer. */
export type Look = 'open' | 'unserved' | 'unknown' | 'signed-out' | 'unreachable'

/** A look's answer, by its status and the `error` it said. */
export function lookOf(status: number | null, error: unknown): Look {
  if (status === 426) return 'open'
  if (status === 401) return 'signed-out'
  if (status === 404) return error === UNKNOWN_APP ? 'unknown' : 'unserved'
  return 'unreachable'
}

export type AppStatus =
  | { is: 'reading' }
  | { is: 'damaged' }
  /** No account to reach it through. */
  | { is: 'signed-out' }
  /** Sync has not given the file its id yet, or the account does not have it yet. */
  | { is: 'syncing' }
  | { is: 'unsynced' }
  /** The account answers that it serves no applications. */
  | { is: 'unserved' }
  | { is: 'connecting' }
  /** The account's relay was not reached in time; still being tried. */
  | { is: 'unreachable' }
  /** The device it runs on is no longer on the account. */
  | { is: 'gone' }
  | { is: 'away' }
  | { is: 'held'; holder: Holder }
  | {
      is: 'here'
      state: AppState | null
      code: number | null
      why: NotStarted | null
      /** Start, Stop or Restart was asked and the host said nothing in time. */
      unanswered: boolean
    }

/** Why the tab is not connected, where that is not just a socket being made. */
type Blocked = 'signed-out' | 'syncing' | 'unsynced' | 'unserved' | 'unreachable'

/** One of the account's devices, as `/v2/devices` lists it. */
interface Device {
  id: string
  name: string
  platform?: string
}

/** As much of the relay's socket as the tab uses. */
export interface Linked {
  open(): void
  close(): void
  say(frame: Parameters<AppLink['say']>[0]): boolean
  take(): boolean
  resize(view: View): void
}

/** What a tab's session reads of the world, so a test can hand in its own. */
export interface SessionWorld {
  read(path: string): Promise<string | null>
  /** The id sync gave the file, waited for until `until`; null if it has none. */
  idOf(path: string, until: number): Promise<string | null>
  token(): string | null
  /** The account's devices, or null where they could not be asked. */
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
  idOf: (path, until) => idOf(path, until),
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
  /** What the file says, once read. */
  file = $state<AppFile | null>(null)
  /** The name of the device it runs on, once the account said it, and its system. */
  hostName = $state('')
  hostPlatform = $state('')
  private damaged = $state(false)
  private blocked = $state<Blocked | null>(null)
  /** Whether the socket was not open by its deadline. */
  private slow = $state(false)
  /** Whether the account lists the host: null until it has said. */
  private hostListed = $state<boolean | null>(null)
  private open = $state(false)
  private hostUp = $state(false)
  private holder = $state<Holder | null>(null)
  private state = $state<AppState | null>(null)
  private code = $state<number | null>(null)
  private why = $state<NotStarted | null>(null)
  private unanswered = $state(false)
  /** Whether this device holds it, as the relay last said; kept while its socket
   *  comes back, since the picture goes peer to peer meanwhile. */
  private holding = false
  private link: Linked | null = null
  private ended = false
  private begun = false
  /** The file's id, once sync gave it one. */
  private id: string | null = null
  private view: View | null = null
  /** Counted up by every new try, so a look that was waiting knows it is stale. */
  private turn = 0
  private tries = 0
  /** The one timer of each kind: the next look, the socket's deadline, the host's answer. */
  private cancelLook: (() => void) | null = null
  private cancelSlow: (() => void) | null = null
  private cancelAnswer: (() => void) | null = null
  /** Its picture, wanted while this device holds it and it runs on a host that is there. */
  readonly picture = new Picture((data) => {
    this.link?.say({ t: 'signal', data })
  })

  constructor(
    private readonly tab: Tab,
    private readonly world: SessionWorld = sessionWorld,
  ) {}

  /** Whether this device holds it now: the one device whose input, Start, Stop and
   *  Restart its host takes (an agent's too, which never takes it over). */
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

  /** Reads the file and connects, once. */
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

  /** From the start: the sign-in, the file's id, and a look at the door. */
  private async connect(): Promise<void> {
    const path = this.tab.path
    const turn = ++this.turn
    if (!path || this.ended) return
    if (!this.world.token()) {
      this.blocked = 'signed-out'
      return
    }
    if (!this.id) {
      this.blocked = 'syncing'
      const id = await this.world.idOf(path, this.world.now() + WAIT)
      if (turn !== this.turn || this.over()) return
      if (!id) {
        this.blocked = 'unsynced'
        return
      }
      this.id = id
    }
    await this.lookIn(turn)
  }

  /** Looks at the door, and opens the socket if it may open; otherwise says why, and
   *  looks again by itself where waiting may change the answer. */
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
    if (look === 'unknown' || look === 'unreachable') this.lookLater(turn)
  }

  private lookLater(turn: number): void {
    this.cancelLook?.()
    const wait = LOOK_AGAIN[Math.min(this.tries, LOOK_AGAIN.length - 1)] ?? 30_000
    this.tries += 1
    this.cancelLook = this.world.after(wait, () => {
      this.cancelLook = null
      if (turn === this.turn) void this.lookIn(turn)
    })
  }

  /** The socket has until `OPEN_DEADLINE` to open; past it the tab says so, and looks at
   *  the door again in case the answer changed - the file deleted, the sign-in ended. */
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

  /** Try again, from the start: after signing in, or once sync or the account is back. */
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

  /** The device it runs on, by the name the account knows it by; and whether the
   *  account still lists it at all. */
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

  /** Whether the tab went while something was waited for. */
  private over(): boolean {
    return this.ended
  }

  /** Take over, or take back. */
  take(): void {
    this.link?.take()
  }

  /** Start, stop or restart it on its host, which has `ANSWER_WITHIN` to say anything. */
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

  /** The tab has gone: the socket with it, and the application goes on. */
  end(): void {
    this.ended = true
    this.turn += 1
    this.cancelLook?.()
    this.cancelAnswer?.()
    this.picture.end()
    this.closeLink()
  }
}

/** The id sync gave the file at `path`, waited for while a new one is taken in. */
export async function idOf(path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync2/runner.svelte')
  for (;;) {
    const id = runner.engine?.entryAt(path)?.id ?? null
    if (id || Date.now() >= until) return id
    await pause(LOOK_EVERY)
  }
}

/** Every application tab's session, by the tab's id. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
const sessions = new Map<string, AppSession>()
let watching = false

/** The tab's session if it has one yet, which a hover card asks without making one. */
export function appSessionIfAny(tab: Tab): AppSession | null {
  return sessions.get(tab.id) ?? null
}

/** The tab's session, made once; a tab that has gone takes its socket with it. */
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
