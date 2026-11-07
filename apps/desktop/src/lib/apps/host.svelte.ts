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
import { find } from './session.svelte'

export const FIRST_VIEW: View = { width: 1280, height: 800, dpr: 1, hz: 60 }

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

export interface Said {
  state: 'running' | 'stopped' | 'exited'
  code: number | null
  why?: string
}

export interface Runner {
  start(
    key: string,
    file: AppFile,
    view: View,
    said: (what: Said) => void,
  ): Promise<NotStarted | null>
  watch(key: string, said: (what: Said) => void): Promise<boolean>
  stop(key: string): Promise<void>
  signal(key: string, data: string): Promise<string | null>
  view(key: string, view: View): Promise<void>
}

export const BYE = toHostText({ bye: true })

export interface Speaking {
  open(): void
  close(): void
  say(frame: HostFrame): boolean
}

class Hosting {
  private view: View = FIRST_VIEW
  private state: StateFrame

  private restarting = false
  private holder: string | null = null
  private signalling: Promise<unknown> = Promise.resolve()
  private ended = false
  readonly link: Speaking

  constructor(
    private readonly key: string,
    private readonly file: AppFile,
    private readonly runner: Runner,
    link: (heard: (what: RelayToHost | Opened) => void) => Speaking,
    private readonly cannot: NotStarted | null = null,
  ) {
    this.state = cannot
      ? { t: 'state', state: 'stopped', why: cannot }
      : { t: 'state', state: 'stopped' }
    this.link = link((what) => {
      this.heard(what)
    })
  }

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
    const why = NOT_STARTED.find((one) => one === said.why)
    this.tell(
      said.state === 'exited'
        ? { t: 'state', state: 'exited', code: said.code, ...(why ? { why } : {}) }
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

  end(stop: boolean): void {
    this.ended = true
    this.link.close()
    this.bye()
    if (stop) void this.runner.stop(this.key)
  }
}

export interface HostWorld {
  device(): Promise<string>
  files(): string[]
  read(path: string): Promise<string | null>
  idOf(path: string): Promise<string | null>
  serves(): Promise<boolean>
  cannot: NotStarted | null
  runner: Runner
  link(app: string, heard: (what: RelayToHost | Opened) => void): Speaking
}

export function host(world: HostWorld, follow: (changed: () => void) => () => void): () => void {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
  const hosting = new Map<string, { id: string; one: Hosting }>()
  let stopped = false
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

  void native
    .invoke<unknown>('apps_installed')
    .then((listed) => {
      const token = account.accountToken
      const apps = catalogueOf(listed)
      if (!token || !apps) return
      return request(CATALOGUE_PATH, { method: 'PUT', token, body: { apps: fitCatalogue(apps) } })
    })
    .catch(() => undefined)

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
      cannot: ['linux', 'windows', 'macos'].includes(platform()) ? null : 'isolation',
      files: () => applicationFiles(untrack(() => workspace.tree)),
      read: (path) => native.invoke<string>('read_note', { path }).catch(() => null),
      idOf: async (path) => {
        const found = await find(path, Date.now() + 20_000)
        return 'id' in found ? found.id : null
      },
      runner,
      link: (app, heard) => new HostLink(app, linkWorld, heard),
    },
    follow: (changed) => {
      let seen: unknown = undefined
      return $effect.root(() => {
        $effect(() => {
          const tree = workspace.tree
          if (tree === seen) return
          seen = tree
          untrack(changed)
        })
      })
    },
  }
}

/** @public */
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
