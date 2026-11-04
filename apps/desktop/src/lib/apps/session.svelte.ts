/** An application's tab, as it stands (docs/apps.md): which device it runs on, whether
 *  that device is there, where the application is, and who holds it. Kept per tab and
 *  outliving the pane that draws it, as a terminal's session does.
 *
 *  The file says the host and what runs; the account names the relay by the file's id,
 *  never by its words, as an online terminal's. */

import {
  type AppFile,
  appFileOf,
  type AppState,
  type NotStarted,
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

/** How long a file just made is waited for, for sync to give it its id. */
const WAIT = 20_000
const LOOK_EVERY = 100

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

export type AppStatus =
  | { is: 'reading' }
  | { is: 'damaged' }
  | { is: 'connecting' }
  | { is: 'away' }
  | { is: 'held'; holder: Holder }
  | { is: 'here'; state: AppState | null; code: number | null; why: NotStarted | null }

export class AppSession {
  /** What the file says, once read. */
  file = $state<AppFile | null>(null)
  /** The name of the device it runs on, once the account said it. */
  hostName = $state('')
  private damaged = $state(false)
  private open = $state(false)
  private hostUp = $state(false)
  private holder = $state<Holder | null>(null)
  private state = $state<AppState | null>(null)
  private code = $state<number | null>(null)
  private why = $state<NotStarted | null>(null)
  private link: AppLink | null = null
  private ended = false

  constructor(private readonly tab: Tab) {}

  get status(): AppStatus {
    if (this.damaged) return { is: 'damaged' }
    if (!this.file) return { is: 'reading' }
    if (!this.open) return { is: 'connecting' }
    if (this.holder) return { is: 'held', holder: this.holder }
    if (!this.hostUp) return { is: 'away' }
    return { is: 'here', state: this.state, code: this.code, why: this.why }
  }

  /** Reads the file and connects, once. */
  async start(view: View): Promise<void> {
    if (this.link || this.ended) return
    const path = this.tab.path
    if (!path) return
    const { invoke } = await import('../tauri')
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    const file = text === null ? null : appFileOf(text)
    if (!file) {
      this.damaged = true
      return
    }
    this.file = file
    void this.nameHost(file.host)

    const id = await idOf(path, Date.now() + WAIT)
    if (!id || this.gone()) return
    const { deviceId } = await import('../sync2/hub.svelte')
    this.link = new AppLink(
      id,
      pageWorld(BASE, () => account.accountToken, deviceId),
      (heard) => {
        this.heard(heard)
      },
      view,
    )
    this.link.open()
  }

  private heard(what: AppHeard): void {
    switch (what.t) {
      case 'open':
        this.open = true
        return
      case 'dropped':
        this.open = false
        this.holder = null
        return
      case 'held':
        this.holder = { by: what.by, since: what.since, taken: what.taken }
        return
      case 'hold':
        this.holder = null
        return
      case 'host':
        this.hostUp = what.up
        return
      case 'state':
        this.state = what.state
        this.code = what.code ?? null
        this.why = what.why ?? null
        return
      case 'signal':
      case 'refused':
        return
    }
  }

  /** The device it runs on, by the name the account knows it by. */
  private async nameHost(host: string): Promise<void> {
    const { request } = await import('../api')
    const token = account.accountToken
    if (!token) return
    const listed = await request<{ devices?: { id: string; name: string }[] }>('/v2/devices', {
      token,
    }).catch(() => null)
    this.hostName = listed?.devices?.find((one) => one.id === host)?.name ?? ''
  }

  /** Whether the tab went while the file or its id was being waited for. */
  private gone(): boolean {
    return this.ended
  }

  /** Take over, or take back. */
  take(): void {
    this.link?.take()
  }

  /** Start, stop or restart it on its host. */
  run(what: 'start' | 'stop' | 'restart'): void {
    this.link?.say({ t: 'run', what })
  }

  resize(view: View): void {
    this.link?.resize(view)
  }

  /** The tab has gone: the socket with it, and the application goes on. */
  end(): void {
    this.ended = true
    this.link?.close()
    this.link = null
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
