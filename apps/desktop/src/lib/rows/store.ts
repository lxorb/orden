import type { Row } from '@orden/bases'
import type { ScannedNote, SpaceLinks } from '@orden/scan/note'
import { scanNote } from '@orden/scan/note'
import { AGENTS_NAME } from '../note-name'
import { scanRows } from '@orden/bases/scan'
import { insideSpace, isMarkdownPath, pathKey, samePath, within } from '../space-paths'
import { type FileOp } from '../workspace/file-ops'
import { movedRows, type NoteRead, rowsOf } from '@orden/bases/rows'
import { datesChanged, type DatesPatch, withDates } from '@orden/bases/todo-lists'
import { todayOf } from '@orden/bases'

export interface SpaceName {
  root: string
  name: string
}

export interface RowsChange {
  root: string
  space: string
  path: string | null
  removed: readonly Row[]
  added: readonly Row[]
  from?: { space: string; path: string; rows: readonly Row[] }
}

export type RowsListener = (change: RowsChange) => void

export interface Host {
  scan(root: string): Promise<SpaceLinks | null>
  read(path: string): Promise<string | null>
  open(): { root: string | null; scanned(): Promise<void>; notes(): readonly ScannedNote[] }
  breathe(): Promise<void>
  now(): number
  own?(root: string): readonly string[]
  vault(root: string): Promise<boolean>
  meta?(root: string, path: string): Readonly<Record<string, string>> | null
  list?(root: string, path: string, meta: Readonly<Record<string, string>> | null): boolean
  dated?(root: string, path: string, patch: DatesPatch): void
}

const CHUNK = 250

const CARRIED = 10 * 60_000

const MOST_LEFT = 500

interface Left {
  hash: string
  cancelled: boolean
  day: string
  at: number
}

interface Held {
  root: string
  name: string
  files: Map<string, Row[]>
  flat: Row[] | null
  reading: boolean
  since: ((files: Map<string, Row[]>) => void)[]
  vault: boolean
}

export class RowsStore {
  private readonly spaces = new Map<string, Held>()
  private readonly listeners = new Set<RowsListener>()
  private readonly queue: Held[] = []
  private draining = false

  constructor(private readonly host: Host) {}

  of(space?: string): readonly Row[] {
    if (space === undefined) return [...this.spaces.values()].flatMap((held) => this.flat(held))

    const held = [...this.spaces.values()].find(
      (one) => one.name === space || samePath(one.root, space),
    )
    return held ? this.flat(held) : []
  }

  openOf(space: string | undefined, locked: (path: string) => boolean): readonly Row[] {
    return this.of(space).filter((row) => {
      const root = this.rootOf(row)
      return root === null || !locked(insideSpace(root, row.path))
    })
  }

  at(path: string): readonly Row[] {
    const held = this.holding(path)
    if (!held) return []
    const relative = within(held.root, path, held.root)
    return relative === null ? [] : (held.files.get(pathKey(relative, held.root)) ?? [])
  }

  rootOf(row: Row): string | null {
    return [...this.spaces.values()].find((one) => one.name === row.space)?.root ?? null
  }

  get ready(): boolean {
    return [...this.spaces.values()].every((one) => !one.reading) && !this.queue.length
  }

  watch(listener: RowsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  settled(listener: () => void): () => void {
    let due = false
    let live = true
    const stop = this.watch(() => {
      if (due) return
      due = true
      queueMicrotask(() => {
        due = false
        if (live) listener()
      })
    })
    return () => {
      live = false
      stop()
    }
  }

  spacesAre(spaces: readonly SpaceName[]) {
    for (const [key, held] of this.spaces) {
      if (!spaces.some((one) => samePath(one.root, held.root))) this.forget(key)
    }

    for (const space of spaces) {
      const held = this.spaces.get(pathKey(space.root))
      if (!held) {
        this.add(space)
        continue
      }
      if (held.name !== space.name) this.rename(held, space.name)
    }
  }

  saved(path: string, content: string, settles = true) {
    const held = this.holding(path)
    if (!held) return
    const relative = within(held.root, path, held.root)
    if (relative === null || !isMarkdownPath(relative)) return

    const key = pathKey(relative, held.root)
    const now = this.host.now()
    const was = held.reading ? undefined : held.files.get(key)
    this.edit(held, key, (before) => {
      const known = before?.[0]?.file.ctime ?? 0
      const ctime = known > 0 ? known : now
      const stamp = { size: content.length, mtime: now, ctime }
      return this.rowsIn(
        held,
        readOf({ ...scanNote(relative, content), ...scanRows(content), stamp }),
      )
    })
    if (!settles) return
    const settling = { held, key, again: false }
    this.settling = settling
    try {
      this.settle(held, relative, was ?? null, held.files.get(key) ?? [], now)
    } finally {
      this.settling = null
    }
    if (settling.again) this.saved(path, content, false)
  }

  private settling: { held: Held; key: string; again: boolean } | null = null

  private settle(held: Held, relative: string, was: Row[] | null, now: Row[], at: number) {
    if (!this.host.dated) return
    if (was !== null) this.leaving(was, now, at)
    const meta = this.host.meta?.(held.root, relative) ?? null
    const arrived = (hash: string, cancelled: boolean) => this.arrived(hash, cancelled, at)
    const patch = datesChanged(was, now, meta, todayOf(new Date(at)), arrived)
    if (patch) this.host.dated(held.root, relative, patch)
  }

  private left: Left[] = []

  private leaving(was: readonly Row[], now: readonly Row[], at: number) {
    const closed = (rows: readonly Row[], cancelled: boolean) => {
      const out = new Map<string, (string | undefined)[]>()
      for (const row of rows) {
        const task = row.task
        const hash = row.anchor?.hash
        if (!task || hash === undefined || (cancelled ? !task.cancelled : !task.done)) continue
        const day = cancelled ? task.cancelledOn : task.completed
        out.set(hash, [...(out.get(hash) ?? []), day])
      }
      return out
    }
    for (const cancelled of [false, true]) {
      const after = closed(now, cancelled)
      for (const [hash, days] of closed(was, cancelled)) {
        const gone = days.length - (after.get(hash)?.length ?? 0)
        for (const day of days.slice(days.length - Math.max(0, gone))) {
          if (day !== undefined) this.left.push({ hash, cancelled, day, at })
        }
      }
    }
    this.left = this.left.filter((one) => at - one.at < CARRIED).slice(-MOST_LEFT)
  }

  private arrived(hash: string, cancelled: boolean, at: number): string | undefined {
    for (let index = this.left.length - 1; index >= 0; index--) {
      const one = this.left[index]
      if (one?.hash !== hash || one.cancelled !== cancelled || at - one.at >= CARRIED) continue
      this.left.splice(index, 1)
      return one.day
    }
    return undefined
  }

  indexed(root: string, scans: readonly ScannedNote[]) {
    const held = this.spaces.get(pathKey(root))
    if (!held) return
    for (const scan of scans) {
      if (!isMarkdownPath(scan.path) || scan.tasks === undefined) continue
      this.edit(held, pathKey(scan.path, held.root), () => this.rowsIn(held, readOf(scan)))
    }
  }

  follow(op: FileOp): Promise<void> | undefined {
    if (op.op === 'removed') {
      if (op.kind === 'space') this.forget(pathKey(op.path))
      else this.gone(op.path)
      return undefined
    }

    if (op.op === 'moved') {
      if (op.kind === 'space') this.spaceMoved(op.from, op.to)
      else if (this.moved(op.from, op.to)) return undefined
      else return op.kind === 'folder' ? this.folderCame(op.to) : this.fileCame(op.to, !op.heard)
      return undefined
    }

    return op.kind === 'folder' ? this.folderCame(op.path) : this.fileCame(op.path, !op.heard)
  }

  private flat(held: Held): Row[] {
    held.flat ??= [...held.files.values()].flat()
    return held.flat
  }

  private rowsIn(held: Held, read: NoteRead): Row[] {
    if (samePath(read.path, AGENTS_NAME, held.root)) return []
    const meta = this.host.meta?.(held.root, read.path) ?? null
    const listed = this.host.list?.(held.root, read.path, meta) ?? true
    const rows = withDates(
      rowsOf(held.name, { ...read, tasks: listed ? read.tasks : [], meta }),
      meta,
    )
    if (held.vault) for (const row of rows) if (row.task) row.task.dueReads = 'deadline'
    return rows
  }

  private holding(path: string): Held | null {
    for (const held of this.spaces.values()) {
      if (within(held.root, path, held.root) !== null) return held
    }
    return null
  }

  private tell(change: RowsChange) {
    for (const listener of this.listeners) listener(change)
  }

  private edit(
    held: Held,
    key: string,
    next: (before: Row[] | undefined) => Row[] | null,
    from?: RowsChange['from'],
  ) {
    const change = (files: Map<string, Row[]>) => {
      const rows = next(files.get(key))
      if (!rows?.length) files.delete(key)
      else files.set(key, rows)
    }
    if (held.reading) held.since.push(change)

    const before = held.files.get(key) ?? []
    change(held.files)
    held.flat = null
    const after = held.files.get(key) ?? []
    const path = after[0]?.path ?? before[0]?.path ?? key
    const told: RowsChange = {
      root: held.root,
      space: held.name,
      path,
      removed: before,
      added: after,
    }
    this.tell(from ? { ...told, from } : told)
  }

  private add(space: SpaceName) {
    const held: Held = {
      root: space.root,
      name: space.name,
      files: new Map(),
      flat: null,
      reading: true,
      since: [],
      vault: false,
    }
    this.spaces.set(pathKey(space.root), held)
    this.queue.push(held)
    void this.drain()
  }

  private forget(key: string) {
    const held = this.spaces.get(key)
    if (!held) return
    this.spaces.delete(key)
    const removed = this.flat(held)
    this.tell({ root: held.root, space: held.name, path: null, removed, added: [] })
  }

  private rename(held: Held, name: string) {
    const removed = this.flat(held)
    held.name = name
    for (const [key, rows] of held.files)
      held.files.set(
        key,
        rows.map((row) => ({ ...row, space: name })),
      )
    held.flat = null
    this.tell({ root: held.root, space: name, path: null, removed, added: this.flat(held) })
  }

  private spaceMoved(from: string, to: string) {
    const held = this.spaces.get(pathKey(from))
    if (!held) return
    this.spaces.delete(pathKey(from))
    held.root = to
    this.spaces.set(pathKey(to), held)
  }

  private gone(path: string) {
    const held = this.holding(path)
    if (!held) return
    const at = within(held.root, path, held.root)
    if (at === null) return

    if (held.reading) {
      held.since.push((files) => {
        for (const [key, rows] of files) {
          const under = rows[0]?.path
          if (under !== undefined && within(at, under, held.root) !== null) files.delete(key)
        }
      })
    }
    for (const key of this.keysUnder(held, at)) this.edit(held, key, () => null)
  }

  private moved(from: string, to: string): boolean {
    const was = this.holding(from)
    const now = this.holding(to)
    if (!was) return !now
    const at = within(was.root, from, was.root)
    const there = now ? within(now.root, to, now.root) : null
    if (at === null) return true

    if (was.reading || now?.reading) {
      this.gone(from)
      return !now
    }

    for (const key of this.keysUnder(was, at)) {
      const rows = was.files.get(key) ?? []
      const path = rows[0]?.path
      this.edit(was, key, () => null)
      if (!now || there === null || path === undefined) continue

      const rest = within(at, path, was.root) ?? ''
      const moved = rest ? (there ? `${there}/${rest}` : rest) : there
      this.edit(
        now,
        pathKey(moved, now.root),
        (saved) => (saved?.length ? bornWhen(saved, rows) : movedRows(rows, moved, now.name)),
        { space: was.name, path, rows },
      )
    }
    return true
  }

  private keysUnder(held: Held, at: string): string[] {
    const keys: string[] = []
    for (const [key, rows] of held.files) {
      const path = rows[0]?.path
      if (path !== undefined && within(at, path, held.root) !== null) keys.push(key)
    }
    return keys
  }

  again(root: string) {
    const held = this.spaces.get(pathKey(root))
    if (!held || held.reading) return
    held.reading = true
    this.queue.push(held)
    void this.drain()
  }

  described(path: string): void {
    const settling = this.settling
    const relative = settling && within(settling.held.root, path, settling.held.root)
    if (settling && relative && pathKey(relative, settling.held.root) === settling.key) {
      settling.again = true
      return
    }
    void this.fileCame(path, false)
  }

  private async fileCame(path: string, settles = true) {
    const held = this.holding(path)
    if (!held || !isMarkdownPath(path)) return
    const content = await this.host.read(path)
    if (content !== null) this.saved(path, content, settles)
  }

  private async folderCame(path: string) {
    const held = this.holding(path)
    if (!held) return
    const at = within(held.root, path, held.root)
    const found = await this.host.scan(path)
    if (!found || at === null || this.spaces.get(pathKey(held.root)) !== held) return

    for (const note of found.notes) {
      const relative = at ? `${at}/${note.path}` : note.path
      if (!isMarkdownPath(relative)) continue
      this.edit(held, pathKey(relative, held.root), () =>
        this.rowsIn(held, readOf({ ...note, path: relative })),
      )
    }
  }

  private async drain() {
    if (this.draining) return
    this.draining = true
    try {
      for (let held = this.queue.shift(); held; held = this.queue.shift()) {
        await this.read(held).catch(() => undefined)
        held.reading = false
        await this.host.breathe()
      }
    } finally {
      this.draining = false
    }
  }

  private async read(held: Held) {
    held.vault = await this.host.vault(held.root).catch(() => false)
    const notes = await this.notesOf(held)
    if (this.spaces.get(pathKey(held.root)) !== held) return

    const files = new Map<string, Row[]>()
    let counted = 0
    for (const note of notes) {
      if (!isMarkdownPath(note.path)) continue
      if (note.tasks === undefined) {
        const content = await this.host.read(insideSpace(held.root, note.path))
        if (content !== null) {
          const stamp = { size: content.length, mtime: this.host.now(), ctime: this.host.now() }
          files.set(
            pathKey(note.path, held.root),
            this.rowsIn(held, readOf({ ...note, ...scanRows(content), stamp })),
          )
        }
      } else {
        files.set(pathKey(note.path, held.root), this.rowsIn(held, readOf(note)))
      }
      if (++counted % CHUNK === 0) await this.host.breathe()
    }

    for (const relative of this.host.own?.(held.root) ?? []) {
      const content = await this.host.read(insideSpace(held.root, relative))
      if (content === null || this.spaces.get(pathKey(held.root)) !== held) continue
      const stamp = { size: content.length, mtime: 0, ctime: 0 }
      files.set(
        pathKey(relative, held.root),
        this.rowsIn(held, readOf({ ...scanNote(relative, content), ...scanRows(content), stamp })),
      )
    }
    if (this.spaces.get(pathKey(held.root)) !== held) return

    for (const change of held.since) change(files)
    held.since = []
    const removed = this.flat(held)
    held.files = files
    held.flat = null
    held.reading = false
    this.tell({ root: held.root, space: held.name, path: null, removed, added: this.flat(held) })
  }

  private async notesOf(held: Held): Promise<readonly ScannedNote[]> {
    const open = this.host.open()
    if (samePath(open.root, held.root)) {
      await open.scanned()
      const now = this.host.open()
      if (samePath(now.root, held.root)) return now.notes()
    }
    return (await this.host.scan(held.root))?.notes ?? []
  }
}

export function noteRowsOf(space: string, relative: string, content: string): Row[] {
  const stamp = { size: content.length, mtime: 0, ctime: 0 }
  return rowsOf(space, readOf({ ...scanNote(relative, content), ...scanRows(content), stamp }))
}

function readOf(note: ScannedNote): NoteRead {
  return {
    path: note.path,
    front: note.front ?? null,
    tasks: note.tasks ?? [],
    stamp: note.stamp ?? null,
    tags: note.tags,
    links: note.links,
  }
}

function bornWhen(saved: readonly Row[], had: readonly Row[]): Row[] {
  const first = saved[0]
  const ctime = had[0]?.file.ctime
  if (!first || ctime === undefined || first.file.ctime === ctime) return [...saved]
  const file = { ...first.file, ctime }
  return saved.map((row) => ({ ...row, file }))
}
