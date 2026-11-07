import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Activity } from '@orden/online/types'
import { isLoopbackUrl } from '@orden/online/urls'
import type { MachineFrame, OrdendFrame, SessionNow } from '@orden/online/wire'
import { diskOf, Meter, homeSize } from './activity'
import { Held, socketOf } from './held'
import { Images } from './images'
import type { Cgroups, User } from './limits'
import { Saves, isSessionId, type Saved } from './saves'
import { programOf } from './proc'
import { Session } from './session'

export interface Options {
  state: string
  home: string
  shell: string
  user: User | null
  env: Record<string, string>
  pidsMax: number
  cgroups: Cgroups | null
  activityEvery: number
  homeEvery: number
  saveEvery?: number
  call?: (url: string) => Promise<number>
  restart?: () => void
  holder: string
}

const CALL_WAIT = 10_000

async function call(url: string): Promise<number> {
  try {
    const answer = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(CALL_WAIT) })
    await answer.body?.cancel()
    return answer.status
  } catch {
    return 0
  }
}

export class Ordend {
  private readonly sessions = new Map<string, Session>()
  private readonly opening = new Map<string, Promise<void>>()
  private readonly saves: Saves
  private readonly options: Options
  private readonly meter = new Meter(Date.now())
  private link: ((frame: OrdendFrame) => void) | null = null
  private homeBytes = 0
  private lastTyped: string | null = null
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private readonly images: Images
  private readonly holds: string

  constructor(options: Options) {
    this.options = options
    this.images = new Images(options.home, options.user)
    this.saves = new Saves(options.state)
    this.holds = join(options.state, 'holds')
    mkdirSync(this.holds, { recursive: true, mode: 0o700 })
    for (const saved of this.saves.all()) {
      this.sessions.set(saved.session, this.session(saved.session, saved.cols, saved.rows, saved))
    }
    this.timers.push(
      setInterval(() => {
        this.report()
      }, options.activityEvery),
      setInterval(() => {
        void this.measure()
      }, options.homeEvery),
    )
    if (options.saveEvery) {
      this.timers.push(
        setInterval(() => {
          void this.saveAll(false)
        }, options.saveEvery),
      )
    }
    void this.measure()
  }

  attach(send: ((frame: OrdendFrame) => void) | null): void {
    this.link = send
  }

  private send(frame: OrdendFrame): void {
    this.link?.(frame)
  }

  private session(id: string, cols: number, rows: number, saved?: Saved): Session {
    return new Session(
      id,
      cols,
      rows,
      {
        ...this.options,
        holds: this.holds,
        send: (frame) => {
          this.send(frame)
        },
      },
      saved,
    )
  }

  async receive(frame: MachineFrame): Promise<void> {
    if (frame.t === 'sleep') {
      await this.saveAll()
      return
    }
    if (frame.t === 'restart') {
      await this.saveAll(false)
      this.options.restart?.()
      return
    }
    if (frame.t === 'list') {
      this.send({ t: 'sessions', sessions: await this.list() })
      return
    }
    if (frame.t === 'ping') {
      this.send({ t: 'pong' })
      return
    }
    if (!isSessionId(frame.session)) return
    const opening = frame.t === 'open' ? undefined : this.opening.get(frame.session)
    if (opening) await opening.catch(() => undefined)
    const session = this.sessions.get(frame.session)
    switch (frame.t) {
      case 'open':
        if (!session) {
          if (frame.watching) await this.watcherOpens(frame.session, frame.cols, frame.rows)
          else this.sessions.set(frame.session, this.session(frame.session, frame.cols, frame.rows))
        } else if (!session.alive && !frame.watching) {
          session.restart()
        }
        return
      case 'in':
        session?.input(frame.data)
        if (session) this.lastTyped = frame.session
        return
      case 'size':
        session?.resize(frame.cols, frame.rows)
        return
      case 'want':
        await session?.want(frame.since)
        return
      case 'close':
        if (session) session.end()
        else this.endHeld(frame.session)
        this.sessions.delete(frame.session)
        this.saves.forget(frame.session)
        return
      case 'callback': {
        if (!isLoopbackUrl(frame.url)) return
        const status = await (this.options.call ?? call)(frame.url)
        this.send({ t: 'called', session: frame.session, url: frame.url, status })
        return
      }
      case 'image': {
        const path = await this.images.part(frame.id, frame.kind, frame.data, frame.last)
        if (path !== undefined)
          this.send({ t: 'image', session: frame.session, id: frame.id, path })
        return
      }
    }
  }

  async list(): Promise<SessionNow[]> {
    const listed = [...this.sessions.values()].map((one) => one.now())
    let sockets: string[]
    try {
      sockets = readdirSync(this.holds)
    } catch {
      sockets = []
    }
    const others = sockets
      .map((name) => name.replace(/.sock$/, ''))
      .filter((id) => isSessionId(id) && !this.sessions.has(id))
    const found = await Promise.all(others.map((id) => this.holderOf(id)))
    return [...listed, ...found.filter((one) => one !== null)]
  }

  private async watcherOpens(id: string, cols: number, rows: number): Promise<void> {
    const opens = async () => {
      if (!(await this.holderOf(id))?.alive) return
      if (!this.sessions.has(id)) this.sessions.set(id, this.session(id, cols, rows))
    }
    const opening = opens()
    this.opening.set(id, opening)
    try {
      await opening
    } finally {
      if (this.opening.get(id) === opening) this.opening.delete(id)
    }
  }

  private async holderOf(id: string): Promise<SessionNow | null> {
    const held = new Held(socketOf(this.holds, id), { out: () => undefined, exit: () => undefined })
    const hello = await held.find()
    held.detach()
    if (!hello) return null
    const alive = hello.exited === null
    return {
      session: id,
      program: alive ? programOf(hello.shell) : null,
      title: null,
      alive,
      at: null,
    }
  }

  open(url: string, session: string): boolean {
    const id = this.sessions.has(session) ? session : this.lastTyped
    if (!this.link || id === null || !this.sessions.has(id)) return false
    this.send({ t: 'browse', session: id, url })
    return true
  }

  async saveAll(say = true): Promise<void> {
    const at = Date.now()
    for (const session of this.sessions.values()) {
      try {
        this.saves.write(await session.save(at))
      } catch {
        // A full disk loses this one screen, never the others or the sleep.
      }
    }
    if (say) this.send({ t: 'saved' })
  }

  activity(): Activity {
    const now = Date.now()
    const { cpu, net } = this.meter.since(now)
    let output = 0
    for (const session of this.sessions.values()) output += session.taken()
    const disk = diskOf(this.options.home)
    return { at: now, output, cpu, net, homeBytes: this.homeBytes, ...(disk ? { disk } : {}) }
  }

  private report(): void {
    if (!this.link) return
    this.send({ t: 'activity', activity: this.activity() })
  }

  private async measure(): Promise<void> {
    const bytes = await homeSize(this.options.home)
    if (bytes !== null) this.homeBytes = bytes
  }

  pause(paused: boolean): void {
    for (const session of this.sessions.values()) session.pause(paused)
  }

  private endHeld(id: string): void {
    this.options.cgroups?.kill(id)
    const held = new Held(socketOf(this.holds, id), {
      out: () => undefined,
      exit: () => undefined,
    })
    held.kill()
    void held.find()
  }

  stop(ending = false): void {
    for (const timer of this.timers) clearInterval(timer)
    for (const session of this.sessions.values()) {
      if (ending) session.end()
      else session.detach()
    }
    this.sessions.clear()
  }
}
