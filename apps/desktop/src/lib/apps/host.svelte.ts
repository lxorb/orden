/** This computer as the host of the reader's applications (issue 1063, step 3;
 *  docs/apps.md): for every application file of the space that names this device, a
 *  socket to its relay as the host, the holder's Start, Stop and Restart done by the
 *  crate (`apps_host.rs`), and where the application stands said back.
 *
 *  And the catalogue: what this computer has installed, written to the account so New
 *  application on another device can offer it by name and icon.
 *
 *  Developer mode's, on a desktop, while signed in (App.svelte starts it). The crate
 *  decides what may run - an installed application by the id it found itself, a program
 *  by its path only once the reader here said yes - and where: a display of its own, on
 *  Linux; on Windows and macOS nothing is started yet, and the tab is told why.
 *
 *  And its picture (step 4): the holder's signalling, `signal` frames, handed to the
 *  crate as they come (`apps_host/stream.rs`), which answers the offer and sends the
 *  picture to that device directly; and its answer said back. A new holder, or none,
 *  ends the picture the last one had.
 *
 *  And its size (step 5): the holder's view, said by the relay whenever it changes and
 *  whenever another device takes the application over, handed to the crate, which makes
 *  the display that size. */

import {
  type AppFile,
  appFileOf,
  appSocketPath,
  CATALOGUE_PATH,
  catalogueOf,
  fitCatalogue,
  HOST_PROTOCOL,
  ICE_PATH,
  type HostFrame,
  NOT_STARTED,
  type NotStarted,
  type RelayToHost,
  type StateFrame,
  toHostOf,
  toHostText,
  type View,
} from '@orden/online/apps'
import { untrack } from 'svelte'
import { Channel, type LinkWorld, type Opened } from '../online/link'
import { idOf } from './session.svelte'

/** The view a display is made at until a holder has said its own. */
export const FIRST_VIEW: View = { width: 1280, height: 800, dpr: 1, hz: 60 }

/** The relay's socket, from the host's end. */
export class HostLink extends Channel<RelayToHost, HostFrame> {
  protected path(app: string): string {
    return appSocketPath(app)
  }

  protected helloFrame(): HostFrame {
    return { t: 'host' }
  }

  protected read(data: string | ArrayBuffer): RelayToHost | null {
    return typeof data === 'string' ? toHostOf(data) : null
  }

  protected final(): boolean {
    return false
  }

  protected override role(): string[] {
    return [HOST_PROTOCOL]
  }
}

/** Where an application stands, as the crate says it. */
export interface Said {
  state: 'running' | 'stopped' | 'exited'
  code: number | null
}

/** What the host asks of the crate, so a test can hand in its own. */
export interface Runner {
  /** Starts it, or hears where a running one stands; answers why it did not start. */
  start(
    key: string,
    file: AppFile,
    view: View,
    said: (what: Said) => void,
  ): Promise<NotStarted | null>
  /** Hears where it stands if it is running, as this window reloaded may ask; answers
   *  whether it is. Starts nothing. */
  watch(key: string, said: (what: Said) => void): Promise<boolean>
  stop(key: string): Promise<void>
  /** Hands the holder's signalling to the crate; answers what to say back, if anything. */
  signal(key: string, data: string): Promise<string | null>
  /** The holder's view, as it changes: a running application's display made to it. */
  view(key: string, view: View): Promise<void>
}

/** What ends the picture a holder had: the wire's goodbye. */
export const BYE = toHostText({ bye: true })

/** A socket to the relay, as much of one as an application's host uses. */
export interface Speaking {
  open(): void
  close(): void
  say(frame: HostFrame): boolean
}

/** One application this computer hosts. */
class Hosting {
  private view: View = FIRST_VIEW
  private state: StateFrame

  /** Whether a restart is waiting for the stop it began with. */
  private restarting = false
  /** The device holding it, as the relay last said. */
  private holder: string | null = null
  /** The holder's signalling, handed to the crate one message at a time, in order: a
   *  candidate that overtook its offer would find no picture to add to. */
  private signalling: Promise<unknown> = Promise.resolve()
  private ended = false
  readonly link: Speaking

  constructor(
    private readonly key: string,
    private readonly file: AppFile,
    private readonly runner: Runner,
    link: (heard: (what: RelayToHost | Opened) => void) => Speaking,
    /** Why nothing can run here at all, said to every tab before anybody presses Start. */
    private readonly cannot: NotStarted | null = null,
  ) {
    this.state = cannot
      ? { t: 'state', state: 'stopped', why: cannot }
      : { t: 'state', state: 'stopped' }
    this.link = link((what) => {
      this.heard(what)
    })
  }

  /** Connects, and hears where an application already running stands - one this
   *  window started before it reloaded. Nothing is started by itself: that is the
   *  holder's Start. */
  open(): void {
    this.link.open()
    void this.runner
      .watch(this.key, (said) => {
        this.said(said)
      })
      .catch(() => false)
  }

  private heard(what: RelayToHost | Opened): void {
    switch (what.t) {
      case 'open':
        this.link.say(this.state)
        return
      case 'view':
        // The tab resized, moved to another screen, or another device's: the display
        // follows it while the application runs, and the next start is made at it.
        this.view = what.view
        if (this.state.state === 'running') void this.runner.view(this.key, what.view)
        return
      case 'run':
        if (what.what === 'start') void this.start()
        else if (what.what === 'stop') void this.runner.stop(this.key)
        else {
          this.restarting = this.state.state === 'running'
          if (this.restarting) void this.runner.stop(this.key)
          else void this.start()
        }
        return
      case 'viewer':
        // Another device, or none: the picture the last one had ends.
        if (what.device !== this.holder && this.holder !== null) this.bye()
        this.holder = what.device
        return
      case 'signal': {
        const { data } = what
        this.signalling = this.signalling
          .then(() => this.runner.signal(this.key, data))
          .then((back) => {
            if (back !== null && !this.ended) this.link.say({ t: 'signal', data: back })
          })
          .catch(() => undefined)
        return
      }
      case 'dropped':
        // The picture goes peer to peer, so the relay's socket coming and going is no
        // reason to end it.
        return
    }
  }

  private bye(): void {
    this.signalling = this.signalling
      .then(() => this.runner.signal(this.key, BYE))
      .catch(() => undefined)
  }

  private async start(): Promise<void> {
    if (this.ended || this.state.state === 'running' || this.state.state === 'starting') return
    if (this.cannot) {
      this.tell({ t: 'state', state: 'stopped', why: this.cannot })
      return
    }
    this.tell({ t: 'state', state: 'starting' })
    const why = await this.runner
      .start(this.key, this.file, this.view, (said) => {
        this.said(said)
      })
      .catch((): NotStarted => 'failed')
    if (why !== null) this.tell({ t: 'state', state: 'stopped', why })
  }

  private said(said: Said): void {
    if (said.state === 'running') {
      this.tell({ t: 'state', state: 'running' })
      return
    }
    this.tell(
      said.state === 'exited'
        ? { t: 'state', state: 'exited', code: said.code }
        : { t: 'state', state: 'stopped' },
    )
    if (this.restarting) {
      this.restarting = false
      void this.start()
    }
  }

  private tell(state: StateFrame): void {
    this.state = state
    this.link.say(state)
  }

  /** Its file is gone, or this computer stopped hosting: the socket goes, and with a
   *  file gone the application too. */
  end(stop: boolean): void {
    this.ended = true
    this.link.close()
    this.bye()
    if (stop) void this.runner.stop(this.key)
  }
}

/** What hosting reads of the world, so a test can hand in its own. */
export interface HostWorld {
  /** This device's id on the account. */
  device(): Promise<string>
  /** Every application file of the space, by path, as the tree lists them. */
  files(): string[]
  /** A file's text, or null. */
  read(path: string): Promise<string | null>
  /** The id sync gave a file, waited for a while; null if it has none. */
  idOf(path: string): Promise<string | null>
  /** Whether the account serves applications at all: an older server, or one with the
   *  switch off, answers 404, and no socket is made to be refused over and over. */
  serves(): Promise<boolean>
  /** Why this computer cannot run an application at all, if it cannot. */
  cannot: NotStarted | null
  runner: Runner
  link(app: string, heard: (what: RelayToHost | Opened) => void): Speaking
}

/** Hosts what `world.files()` names for this device, following it as it changes;
 *  answers what stops it. `follow` calls back whenever the list may have changed. */
export function host(world: HostWorld, follow: (changed: () => void) => () => void): () => void {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
  const hosting = new Map<string, { id: string; one: Hosting }>()
  let stopped = false
  /** Read afresh after every wait: the host may have been stopped meanwhile. */
  const over = () => stopped
  let looking: Promise<void> = Promise.resolve()

  const look = async () => {
    if (!(await world.serves())) return
    const device = await world.device()
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once, here
    const files = new Set(world.files())
    for (const [path, held] of hosting) {
      if (files.has(path)) continue
      hosting.delete(path)
      held.one.end(true)
    }
    for (const path of files) {
      if (over() || hosting.has(path)) continue
      const text = await world.read(path)
      const file = text === null ? null : appFileOf(text)
      if (file?.host !== device) continue
      const id = await world.idOf(path)
      if (!id || over() || hosting.has(path)) continue
      const one = new Hosting(
        id,
        file,
        world.runner,
        (heard) => world.link(id, heard),
        world.cannot,
      )
      hosting.set(path, { id, one })
      one.open()
    }
  }
  const again = () => {
    looking = looking.then(look).catch(() => undefined)
  }
  again()
  const unfollow = follow(again)
  return () => {
    stopped = true
    unfollow()
    for (const { one } of hosting.values()) one.end(false)
    hosting.clear()
  }
}

/** Every `.application` file in a tree, by path. */
export function applicationFiles(
  tree: { path: string; is_dir: boolean; children?: unknown[] } | null,
): string[] {
  const found: string[] = []
  const walk = (entry: { path: string; is_dir: boolean; children?: unknown[] }) => {
    if (!entry.is_dir) {
      if (/\.application$/i.test(entry.path)) found.push(entry.path)
      return
    }
    for (const child of entry.children ?? []) walk(child as typeof entry)
  }
  if (tree) walk(tree)
  return found
}

/** This app's world: the crate, sync, the account's relay and the workspace's tree. */
async function appWorld(): Promise<{
  world: HostWorld
  follow: (changed: () => void) => () => void
}> {
  const [
    { account },
    { ApiError, BASE, request },
    { pageWorld },
    { deviceId },
    { workspace },
    native,
    { platform },
  ] = await Promise.all([
    import('../account.svelte'),
    import('../api'),
    import('../online/link'),
    import('../sync2/hub.svelte'),
    import('../workspace.svelte'),
    import('../native'),
    import('../tauri'),
  ])
  const linkWorld: LinkWorld = pageWorld(BASE, () => account.accountToken, deviceId)

  const runner: Runner = {
    async start(key, file, view, said) {
      const events = new native.Channel<Said>()
      events.onmessage = said
      const run =
        file.run.kind === 'installed'
          ? { kind: 'installed', id: file.run.id }
          : { kind: 'path', path: file.run.path, args: file.run.args, cwd: file.run.cwd }
      try {
        await native.invoke('apps_start', { key, run, view, events })
        return null
      } catch (error) {
        const why = String(error)
        return NOT_STARTED.find((one) => one === why) ?? 'failed'
      }
    },
    async watch(key, said) {
      const events = new native.Channel<Said>()
      events.onmessage = said
      return native.invoke<boolean>('apps_watch', { key, events }).catch(() => false)
    },
    async stop(key) {
      await native.invoke('apps_stop', { key }).catch(() => undefined)
    },
    async signal(key, data) {
      return native.invoke<string | null>('apps_signal', { key, data }).catch(() => null)
    },
    async view(key, view) {
      await native.invoke('apps_view', { key, view }).catch(() => undefined)
    },
  }

  // What this computer has installed, written once a launch for New application on the
  // reader's other devices. An account that does not know the route yet answers 404,
  // which is no news.
  void native
    .invoke<unknown>('apps_installed')
    .then((listed) => {
      const token = account.accountToken
      const apps = catalogueOf(listed)
      if (!token || !apps) return
      return request(CATALOGUE_PATH, { method: 'PUT', token, body: { apps: fitCatalogue(apps) } })
    })
    .catch(() => undefined)

  // Asked again at most every ten minutes: a server that serves none answers so until it
  // is updated, and one that could not be reached is tried as if it did.
  let served: { yes: boolean; at: number } | null = null
  const serves = async (): Promise<boolean> => {
    if (served && Date.now() - served.at < 10 * 60_000) return served.yes
    const token = account.accountToken
    if (!token) return false
    const yes = await request(ICE_PATH, { token }).then(
      () => true,
      (error: unknown) => !(error instanceof ApiError && error.status === 404),
    )
    served = { yes, at: Date.now() }
    return yes
  }

  return {
    world: {
      device: deviceId,
      serves,
      // Windows and macOS have no display of an application's own yet (step 8).
      cannot: platform() === 'linux' ? null : 'isolation',
      files: () => applicationFiles(untrack(() => workspace.tree)),
      read: (path) => native.invoke<string>('read_note', { path }).catch(() => null),
      idOf: (path) => idOf(path, Date.now() + 20_000),
      runner,
      link: (app, heard) => new HostLink(app, linkWorld, heard),
    },
    follow: (changed) => {
      let seen: unknown = undefined
      return $effect.root(() => {
        $effect(() => {
          // A new listing of the space is the one news there is of its files.
          const tree = workspace.tree
          if (tree === seen) return
          seen = tree
          untrack(changed)
        })
      })
    },
  }
}

/** Starts hosting this computer's applications; answers what stops it. Fetched by
 *  App.svelte only where it hosts, through an import knip does not follow.
 *  @public */
export function hostApps(): () => void {
  let stop: (() => void) | null = null
  let gone = false
  void appWorld().then(({ world, follow }) => {
    if (!gone) stop = host(world, follow)
  })
  return () => {
    gone = true
    stop?.()
  }
}
