import { existsSync } from 'node:fs'
import type { NibdFrame, Restored, SessionNow } from '@orden/online/wire'
import { Coalescer } from './coalesce'
import { Held, socketOf } from './held'
import type { Hello } from './hold-wire'
import { type Cgroups, shellCommand, type User } from './limits'
import { folderOf, programOf } from './proc'
import { Ring } from './ring'
import type { Saved } from './saves'
import { Scanner } from './scan'
import { Screen } from './screen'

export interface Machine {
  shell: string
  home: string
  user: User | null
  env: Record<string, string>
  pidsMax: number
  cgroups: Cgroups | null
  holder: string
  holds: string
  send(frame: NibdFrame): void
}

const PROGRAM_EVERY = 1000

export class Session {
  readonly id: string
  private readonly machine: Machine
  private readonly screen: Screen
  private ring = new Ring()
  private readonly coalescer: Coalescer
  private held: Held | null
  private shell: number | undefined
  private restoredFrom: Restored | undefined
  private readonly ready: Promise<void>
  private settled = false
  private wanted: { cols: number; rows: number } | null = null
  private printed = 0
  private program: string | null = null
  private sentProgram = ''
  private asking: ReturnType<typeof setTimeout> | null = null
  private askedAt = 0
  private holding: NibdFrame[] | null = null
  private over = false
  private answering: Promise<void> = Promise.resolve()
  private scanner = new Scanner()
  private scanned = 0
  private heard = 0
  private printedAt: number | null = null

  constructor(id: string, cols: number, rows: number, machine: Machine, saved?: Saved) {
    this.id = id
    this.machine = machine
    this.screen = new Screen(saved?.cols ?? cols, saved?.rows ?? rows)
    this.coalescer = new Coalescer((bytes) => {
      this.sent(bytes)
    })
    this.screen.term.onTitleChange(() => {
      this.ask()
    })
    const held = this.hold()
    this.held = held
    this.ready = this.begin(held, cols, rows, saved)
      .catch(() => {
        this.died(held)
      })
      .finally(() => {
        this.settled = true
        const wanted = this.wanted
        this.wanted = null
        if (wanted) this.resize(wanted.cols, wanted.rows)
      })
  }

  get alive(): boolean {
    return this.held !== null
  }

  get restored(): Restored | undefined {
    return this.restoredFrom
  }

  get pid(): number | undefined {
    return this.shell
  }

  restart(): void {
    if (this.held || this.over) return
    const held = this.hold()
    this.held = held
    this.spawn(held, this.machine.home).catch(() => {
      this.died(held)
    })
  }

  private hold(): Held {
    const held: Held = new Held(socketOf(this.machine.holds, this.id), {
      out: (seq, data) => {
        if (this.held === held) this.read(seq, data)
      },
      exit: (code) => {
        this.ended(held, code)
      },
    })
    return held
  }

  private async begin(held: Held, cols: number, rows: number, saved?: Saved): Promise<void> {
    const hello = await held.find()
    if (this.over) return
    if (hello) {
      await this.rejoin(held, hello, saved)
      return
    }
    const folder = saved ? await this.drawBack(saved, cols, rows) : this.machine.home
    if (folder !== null) await this.spawn(held, folder)
  }

  private async rejoin(held: Held, hello: Hello, saved?: Saved): Promise<void> {
    this.shell = hello.shell
    const kept = saved?.v === 2 && saved.seq >= hello.from && saved.seq <= hello.end ? saved : null
    if (saved && saved.seq < hello.base) {
      const first = await firstScreen(saved)
      if (this.over) return
      this.screen.write(first)
      this.screen.write(restoredLine(saved.at))
    } else if (saved?.v === 2) {
      this.screen.write(saved.screen)
    }
    if (this.screen.cols !== hello.cols || this.screen.rows !== hello.rows) {
      this.screen.resize(hello.cols, hello.rows)
    }
    const since = kept ? kept.seq : hello.from
    this.from(since)
    held.attach(since)
    if (!kept && hello.from > hello.base && hello.rows > 1) {
      held.resize(hello.cols, hello.rows - 1)
      held.resize(hello.cols, hello.rows)
    }
    this.ask()
  }

  private async drawBack(saved: Saved, cols: number, rows: number): Promise<string | null> {
    const first = await firstScreen(saved)
    if (this.over) return null
    this.restoredFrom = { at: saved.at, program: saved.program }
    this.from(saved.seq + 1)
    this.screen.write(first)
    this.screen.write(restoredLine(saved.at))
    if (saved.cols !== cols || saved.rows !== rows) this.screen.resize(cols, rows)
    return saved.folder && existsSync(saved.folder) ? saved.folder : this.machine.home
  }

  private async spawn(held: Held, folder: string): Promise<void> {
    const { file, args } = shellCommand(this.machine.shell, this.machine.user, this.machine.pidsMax)
    const base = this.ring.end
    const hello = await held.start(
      this.machine.holder,
      {
        socket: held.path,
        cgroup: this.machine.cgroups?.dirOf(this.id) ?? null,
        file,
        args,
        cwd: folder,
        cols: this.screen.cols,
        rows: this.screen.rows,
        base,
      },
      { ...this.machine.env, NIB_SESSION: this.id },
    )
    if (this.over) return
    this.shell = hello.shell
    this.heard = base
    held.attach(base)
  }

  private from(seq: number): void {
    this.ring = new Ring(seq)
    this.scanner = new Scanner()
    this.scanned = seq
    this.heard = seq
  }

  private read(seq: number, data: Uint8Array): void {
    if (this.over || seq + data.length <= this.heard) return
    if (seq > this.heard) {
      this.coalescer.flush()
      this.ring.skip(seq)
      this.scanner = new Scanner()
      this.scanned = seq
      this.heard = seq
    }
    const fresh = data.subarray(this.heard - seq)
    this.heard = seq + data.length
    this.printed += fresh.length
    this.printedAt = Date.now()
    this.scanner.feed(fresh)
    this.coalescer.push(fresh)
    this.ask()
  }

  private ended(held: Held, code: number | null): void {
    if (this.over || this.held !== held) return
    this.coalescer.flush()
    this.held = null
    this.shell = undefined
    this.emit({ t: 'ended', session: this.id, code })
  }

  private died(held: Held): void {
    if (this.over || this.held !== held) return
    this.held = null
    this.emit({ t: 'ended', session: this.id, code: null })
  }

  private sent(bytes: Uint8Array): void {
    if (this.over) return
    const seq = this.ring.append(bytes)
    this.screen.write(bytes)
    this.emit({ t: 'out', session: this.id, seq, data: bytes })
  }

  private emit(frame: NibdFrame): void {
    if (this.holding) this.holding.push(frame)
    else this.machine.send(frame)
  }

  input(data: Uint8Array): void {
    this.coalescer.typed()
    this.held?.write(data)
    if (data.includes(13)) this.ask()
  }

  pause(paused: boolean): void {
    this.held?.pause(paused)
  }

  resize(cols: number, rows: number): void {
    if (!this.settled) {
      this.wanted = { cols, rows }
      return
    }
    if (this.over || (cols === this.screen.cols && rows === this.screen.rows)) return
    this.coalescer.flush()
    this.screen.resize(cols, rows)
    this.held?.resize(cols, rows)
  }

  want(since: number): Promise<void> {
    this.answering = this.answering.then(
      () => this.answer(since),
      () => this.answer(since),
    )
    return this.answering
  }

  private async answer(since: number): Promise<void> {
    await this.ready
    if (this.over) return
    this.toSafePoint()
    const data = this.ring.since(since)
    if (data) {
      this.machine.send({ t: 'out', session: this.id, seq: since, data })
      return
    }
    const seq = this.ring.end
    const holding: NibdFrame[] = []
    this.holding = holding
    const screen = await this.screen.serialized()
    this.machine.send({
      t: 'screen',
      session: this.id,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      data: screen,
      ...(this.restoredFrom ? { restored: this.restoredFrom } : {}),
    })
    this.holding = null
    for (const frame of holding) this.machine.send(frame)
  }

  private toSafePoint(): void {
    this.coalescer.flush(Math.max(0, this.scanned + this.scanner.safe - this.ring.end))
  }

  now(): SessionNow {
    const shell = this.shell
    return {
      session: this.id,
      program: shell === undefined ? null : programOf(shell),
      title: this.over ? null : this.screen.title,
      alive: this.held !== null,
      at: this.printedAt,
    }
  }

  taken(): number {
    const printed = this.printed
    this.printed = 0
    return printed
  }

  async save(at: number): Promise<Saved> {
    await this.ready
    if (this.over) throw new Error('this session is no longer here')
    this.toSafePoint()
    const seq = this.ring.end
    const screen = this.screen.serialized()
    const shell = this.shell
    return {
      v: 2,
      session: this.id,
      at,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      screen: await screen,
      program: shell === undefined ? this.program : programOf(shell),
      folder: shell === undefined ? null : folderOf(shell),
    }
  }

  end(): void {
    const held = this.held
    this.held = null
    this.letGo()
    this.machine.cgroups?.kill(this.id)
    held?.kill()
  }

  detach(): void {
    const held = this.held
    this.held = null
    this.letGo()
    held?.detach()
  }

  private letGo(): void {
    if (this.over) return
    this.over = true
    if (this.asking) clearTimeout(this.asking)
    this.screen.dispose()
  }

  private ask(): void {
    if (this.asking || this.over) return
    const wait = Math.max(0, this.askedAt + PROGRAM_EVERY - Date.now())
    this.asking = setTimeout(() => {
      this.asking = null
      this.askedAt = Date.now()
      const shell = this.shell
      this.program = shell === undefined ? null : programOf(shell)
      const title = this.screen.title
      const said = JSON.stringify([this.program, title])
      if (said === this.sentProgram) return
      this.sentProgram = said
      this.emit({ t: 'program', session: this.id, name: this.program, title, mark: null })
    }, wait)
  }
}

function firstScreen(saved: Saved): Promise<string> {
  return saved.v === 2
    ? Screen.firstOf(saved.screen, saved.cols, saved.rows)
    : Promise.resolve(saved.screen)
}

function restoredLine(at: number): string {
  const when = new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `\x1b[0m\r\n\x1b[2m${when}\x1b[22m\r\n`
}
