import { toBase64 } from '../bytes'
import { heldForLife, ifFree, locksHere, locksWork } from '../locks'
import { log } from '../log'
import { invoke as crate } from '../native'
import type { Listed, SpaceNews } from '../space-watch'
import { joinPath } from '../tauri'
import { readsAsText } from '../web/commands'
import type { InternalChange, InternalFolder } from './folder'
import { type Mounted, mountOf, mounts } from './roots'

export const WORK = '.work'

export const WORK_KEPT = '.work.json'

const SAVE_AFTER = 1000

export interface Was {
  size: number
  mtime: number
  modified: number
  dir?: true
}

export type Seen = Record<string, Was>

export interface Stamp {
  size: number
  mtime: number
}

export interface WorkDisk {
  readonly root: string
  list(): Promise<Listed[]>
  read(rel: string): Promise<Uint8Array | null>
  write(rel: string, bytes: Uint8Array): Promise<Stamp | null>
  stamp(rel: string): Promise<Stamp | null>
  isDir(rel: string): Promise<boolean>
  mkdir(rel: string): Promise<void>
  remove(rel: string, dir: boolean): Promise<void>
  rename(from: string, to: string): Promise<Stamp | null>
  watch(heard: (news: SpaceNews) => void): Promise<() => void>
  loadSeen(): Promise<string | null>
  saveSeen(text: string): Promise<void>
}

const JUNK = /^(~\$|thumbs\.db$|desktop\.ini$|Icon\r$)/i

export function carried(rel: string): boolean {
  if (rel === '.Inbox.md') return true
  return rel.split('/').every((part) => !!part && !part.startsWith('.') && !JUNK.test(part))
}

const spelled = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

function relOf(root: string, path: string): string | null {
  const base = spelled(root)
  const at = spelled(path)
  if (at === base) return ''
  return at.startsWith(`${base}/`) ? at.slice(base.length + 1) : null
}

const encoder = new TextEncoder()

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function same(one: Uint8Array | null, other: Uint8Array | null): boolean {
  if (one?.byteLength !== other?.byteLength || !one || !other) return one === other
  for (let at = 0; at < one.byteLength; at += 1) if (one[at] !== other[at]) return false
  return true
}

function seenOf(text: string | null): Seen {
  if (!text) return {}
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return {}
    const out: Seen = {}
    for (const [rel, was] of Object.entries(value as Record<string, unknown>)) {
      if (typeof was !== 'object' || was === null) continue
      const one = was as Record<string, unknown>
      if (typeof one.size !== 'number' || typeof one.mtime !== 'number') continue
      if (typeof one.modified !== 'number') continue
      out[rel] = {
        size: one.size,
        mtime: one.mtime,
        modified: one.modified,
        ...(one.dir === true ? { dir: true } : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

function parentsOf(rel: string): string[] {
  const out: string[] = []
  for (let at = rel.lastIndexOf('/'); at > 0; at = rel.lastIndexOf('/', at - 1)) {
    out.push(rel.slice(0, at))
  }
  return out
}

export class Mirror {
  private seen: Seen = {}
  private turn: Promise<unknown> = Promise.resolve()
  private saving: ReturnType<typeof setTimeout> | undefined
  private stops: (() => void)[] = []
  private stopped = false

  constructor(
    private readonly folder: InternalFolder,
    private readonly disk: WorkDisk,
  ) {}

  private queue<T>(run: () => Promise<T>): Promise<T> {
    const mine = this.turn.then(run, run)
    this.turn = mine.catch((error: unknown) => {
      log('warn', `working folder ${this.disk.root}: ${String(error)}`)
    })
    return mine
  }

  async start(): Promise<void> {
    this.seen = seenOf(await this.disk.loadSeen())
    await this.queue(() => this.settle(null))
    if (this.halted()) return
    this.stops.push(
      this.folder.heard((changes) => {
        void this.queue(() => this.fromStore(changes))
      }),
    )
    const unwatch = await this.disk.watch((news) => {
      void this.queue(() => this.fromWork(news))
    })
    if (this.halted()) unwatch()
    else this.stops.push(unwatch)
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const stop of this.stops.splice(0)) stop()
    await this.turn
    await this.save()
  }

  private halted(): boolean {
    return this.stopped
  }

  settled(): Promise<void> {
    return this.turn.then(() => undefined)
  }

  private keep() {
    clearTimeout(this.saving)
    this.saving = setTimeout(() => void this.save(), SAVE_AFTER)
  }

  private async save() {
    clearTimeout(this.saving)
    this.saving = undefined
    await this.disk.saveSeen(JSON.stringify(this.seen)).catch(() => undefined)
  }

  private async storeBytes(rel: string): Promise<Uint8Array | null> {
    if (readsAsText(rel)) {
      const text = await this.folder.readText(rel)
      return text === null ? null : encoder.encode(text)
    }
    return this.folder.read(rel)
  }

  private async intoStore(rel: string, bytes: Uint8Array) {
    if (readsAsText(rel)) await this.folder.write(rel, decoder.decode(bytes))
    else await this.folder.write(rel, bytes)
  }

  private record(rel: string, stamp: Stamp | null, dir = false) {
    const entry = this.folder.atNow(rel)
    if (!stamp || !entry) {
      if (!dir || !entry) Reflect.deleteProperty(this.seen, rel)
      else this.seen[rel] = { size: 0, mtime: 0, modified: entry.modified, dir: true }
      this.keep()
      return
    }
    this.seen[rel] = { ...stamp, modified: entry.modified, ...(dir ? { dir: true } : {}) }
    this.keep()
  }

  private async settle(only: ReadonlySet<string> | null): Promise<void> {
    const store = new Map<string, { dir: boolean; modified: number }>()
    for (const { path, entry } of await this.folder.list()) {
      if (carried(path) && (!only || only.has(path))) {
        store.set(path, { dir: !entry.key, modified: entry.modified })
      }
    }
    const work = new Map<string, Listed>()
    for (const one of only ? await this.stamped(only) : await this.disk.list()) {
      const rel = relOf(this.disk.root, one.path)
      if (rel && carried(rel)) work.set(rel, one)
    }
    const paths = new Set([
      ...store.keys(),
      ...work.keys(),
      ...Object.keys(this.seen).filter((rel) => !only || only.has(rel)),
    ])
    const files = [...paths].filter(
      (rel) => !(store.get(rel)?.dir ?? work.get(rel)?.dir ?? this.seen[rel]?.dir),
    )
    for (const rel of files.sort()) await this.file(rel, store.get(rel), work.get(rel))

    const left = new Set<string>()
    for (const { path, entry } of await this.folder.list()) if (entry.key) left.add(path)
    for (const rel of Object.keys(this.seen)) if (!this.seen[rel]?.dir) left.add(rel)
    const holding = new Set([...left].flatMap(parentsOf))
    const filed = new Set(files)
    const dirs = [...paths].filter((rel) => !filed.has(rel))
    for (const rel of dirs.sort()) {
      await this.dir(rel, store.get(rel), work.get(rel), holding.has(rel))
    }
  }

  private async stamped(only: ReadonlySet<string>): Promise<Listed[]> {
    const out: Listed[] = []
    for (const rel of only) {
      const stamp = await this.disk.stamp(rel)
      const path = joinPath(this.disk.root, rel)
      if (stamp) out.push({ path, dir: false, id: null, ...stamp })
      else if (await this.disk.isDir(rel))
        out.push({ path, dir: true, id: null, size: 0, mtime: 0 })
    }
    return out
  }

  private async file(
    rel: string,
    store: { modified: number } | undefined,
    work: Stamp | undefined,
  ): Promise<void> {
    const was = this.seen[rel]
    const workChanged = work?.size !== was?.size || work?.mtime !== was?.mtime || !was
    const storeChanged = store?.modified !== was?.modified || !was
    if (store && work) {
      if (!workChanged && !storeChanged) return
      if (workChanged && !storeChanged) return this.toStore(rel)
      if (!workChanged && storeChanged) return this.toWork(rel)
      const [mine, theirs] = await Promise.all([this.storeBytes(rel), this.disk.read(rel)])
      if (same(mine, theirs)) {
        this.record(rel, { size: work.size, mtime: work.mtime })
        return
      }
      return work.mtime > store.modified ? this.toStore(rel) : this.toWork(rel)
    }
    if (store) {
      if (was && !storeChanged) {
        await this.folder.remove(rel)
        this.record(rel, null)
        return
      }
      return this.toWork(rel)
    }
    if (work) {
      if (was && !workChanged) {
        await this.disk.remove(rel, false)
        this.record(rel, null)
        return
      }
      return this.toStore(rel)
    }
    this.record(rel, null)
  }

  private async dir(
    rel: string,
    store: { modified: number } | undefined,
    work: Listed | undefined,
    holding: boolean,
  ): Promise<void> {
    const was = this.seen[rel]
    if (store && work) {
      this.record(rel, { size: 0, mtime: 0 }, true)
      return
    }
    if (store) {
      if (was && !holding) await this.folder.remove(rel)
      else await this.disk.mkdir(rel)
    } else if (work) {
      if (was && !holding) await this.disk.remove(rel, true)
      else await this.folder.mkdir(rel)
    }
    this.record(rel, store || work ? { size: 0, mtime: 0 } : null, true)
  }

  private async toStore(rel: string) {
    const bytes = await this.disk.read(rel)
    if (!bytes) return
    if (!same(bytes, await this.storeBytes(rel))) await this.intoStore(rel, bytes)
    this.record(rel, await this.disk.stamp(rel))
  }

  private async toWork(rel: string) {
    const bytes = await this.storeBytes(rel)
    if (!bytes) return
    const stamp = same(bytes, await this.disk.read(rel))
      ? await this.disk.stamp(rel)
      : await this.disk.write(rel, bytes)
    this.record(rel, stamp)
  }

  private async fromStore(changes: readonly InternalChange[]) {
    if (this.stopped) return
    const touched = new Set<string>()
    for (const one of changes) {
      if (one.kind === 'renamed' && (await this.renamedInStore(one.from, one.path, one.dir))) {
        continue
      }
      for (const rel of [one.path, ...(one.kind === 'renamed' ? [one.from] : [])]) {
        if (!carried(rel)) continue
        touched.add(rel)
        for (const seen of Object.keys(this.seen)) if (seen.startsWith(`${rel}/`)) touched.add(seen)
        if (one.dir) {
          for (const { path } of await this.folder.list()) {
            if (path.startsWith(`${rel}/`)) touched.add(path)
          }
        }
      }
    }
    if (touched.size) await this.settle(touched)
  }

  private async renamedInStore(from: string, to: string, dir: boolean): Promise<boolean> {
    const was = this.seen[from]
    if (!was || !carried(from) || !carried(to) || this.seen[to]) return false
    const stamp = await this.disk.stamp(from)
    if (!dir && (stamp?.size !== was.size || stamp.mtime !== was.mtime)) return false
    const moved = await this.disk.rename(from, to).catch(() => undefined)
    if (moved === undefined) return false
    this.moveSeen(from, to)
    if (!dir) this.record(to, moved)
    return true
  }

  private moveSeen(from: string, to: string) {
    for (const rel of Object.keys(this.seen)) {
      if (rel !== from && !rel.startsWith(`${from}/`)) continue
      const was = this.seen[rel]
      Reflect.deleteProperty(this.seen, rel)
      if (was) this.seen[`${to}${rel.slice(from.length)}`] = was
    }
    this.keep()
  }

  private async fromWork(news: SpaceNews) {
    if (this.stopped) return
    if (news.scan) return this.settle(null)
    const touched = new Set<string>()
    for (const one of news.changes) {
      const rel = relOf(this.disk.root, one.path)
      if (rel === null || !rel) continue
      if (one.kind === 'renamed') {
        const from = relOf(this.disk.root, one.from)
        if (from && (await this.renamedInWork(from, rel, one))) continue
        if (from && carried(from)) touched.add(from)
      }
      if (!carried(rel)) continue
      touched.add(rel)
      for (const seen of Object.keys(this.seen)) if (seen.startsWith(`${rel}/`)) touched.add(seen)
    }
    if (touched.size) await this.settle(touched)
  }

  private async renamedInWork(from: string, to: string, now: Listed): Promise<boolean> {
    const was = this.seen[from]
    if (!was || !carried(from) || !carried(to) || this.seen[to]) return false
    const entry = this.folder.atNow(from)
    if (entry?.modified !== was.modified || this.folder.atNow(to)) return false
    await this.folder.move(from, to)
    this.moveSeen(from, to)
    if (!now.dir) this.record(to, { size: now.size, mtime: now.mtime })
    return true
  }
}

function nameOf(folder: string): string {
  return spelled(folder).split('/').pop() ?? ''
}

export function workFolderOf(folder: string): string {
  const cut = folder.replace(/[\\/]+$/, '')
  const at = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\'))
  const home = at < 0 ? '' : cut.slice(0, at)
  return joinPath(home ? joinPath(home, WORK) : WORK, nameOf(cut))
}

function crateDisk(folder: string): WorkDisk {
  const root = workFolderOf(folder)
  const at = (rel: string) => (rel ? joinPath(root, rel) : root)
  const stamp = async (rel: string): Promise<Stamp | null> => {
    const said = await crate<{ modified: number; len: number } | null>('file_stamp', {
      path: at(rel),
    }).catch(() => null)
    return said ? { size: said.len, mtime: said.modified } : null
  }
  return {
    root,
    async list() {
      const { scanWorking } = await import('../space-watch')
      return scanWorking(root)
    },
    read: (rel) =>
      crate<ArrayBuffer>('read_file', { path: at(rel) }).then(
        (bytes) => new Uint8Array(bytes),
        () => null,
      ),
    async write(rel, bytes) {
      await crate('write_bytes', { path: at(rel), base64: toBase64(bytes) })
      return stamp(rel)
    },
    stamp,
    isDir: async (rel) =>
      !(await stamp(rel)) &&
      (await crate<boolean>('path_taken', { path: at(rel) }).catch(() => false)),
    mkdir: (rel) => crate('create_folder', { path: at(rel) }),
    remove: (rel, dir) =>
      crate<undefined>(dir ? 'remove_empty_folder' : 'delete_note', { path: at(rel) }).catch(
        () => undefined,
      ),
    async rename(from, to) {
      await crate('rename_note', { from: at(from), to: at(to) })
      return stamp(to)
    },
    async watch(heard) {
      const { watchWorking, unwatchWorking } = await import('../space-watch')
      await watchWorking(root, heard)
      return () => void unwatchWorking(root).catch(() => undefined)
    },
    loadSeen: () =>
      crate<string>('read_note', { path: joinPath(folder, WORK_KEPT) }).catch(() => null),
    saveSeen: (text) =>
      crate<undefined>('write_bytes', {
        path: joinPath(folder, WORK_KEPT),
        base64: toBase64(encoder.encode(text)),
      }),
  }
}

interface Held {
  ready: Promise<void>
  done: Promise<void>
  stop: AbortController
}

const held = new Map<string, Held>()

const lockOf = (folder: string) => `nib:working:${folder}`

function keep(mount: Mounted, disk: (folder: string) => WorkDisk = crateDisk): Held {
  const key = mount.folder.name
  const had = held.get(key)
  if (had) return had
  const stop = new AbortController()
  let ready: () => void = () => undefined
  let finished: () => void = () => undefined
  const one: Held = {
    ready: new Promise<void>((done) => (ready = done)),
    done: new Promise<void>((done) => (finished = done)),
    stop,
  }
  held.set(key, one)
  const run = async () => {
    if (stop.signal.aborted) return
    const working = disk(key)
    await working.mkdir('').catch(() => undefined)
    const mirror = new Mirror(mount.folder, working)
    try {
      await mirror.start()
    } catch (error) {
      log('warn', `working folder ${working.root}: ${String(error)}`)
    }
    ready()
    await new Promise<void>((done) => {
      if (stop.signal.aborted) done()
      else stop.signal.addEventListener('abort', () => done(), { once: true })
    })
    await mirror.stop()
  }
  const running = () => run().finally(finished)
  void (async () => {
    const locks = locksHere()
    if (!locks || !(await locksWork(locks))) return running()
    const got = await ifFree(locks, lockOf(key), running)
    if (got === 'broken') return running()
    if (got === 'taken') {
      ready()
      stop.signal.addEventListener('abort', finished, { once: true })
      heldForLife(lockOf(key), running, stop.signal)
    }
  })()
  return one
}

export async function workingPath(path: string): Promise<string | null> {
  const found = mountOf(path)
  if (!found) return null
  await keep(found.mount).ready
  const root = workFolderOf(found.mount.folder.name)
  return found.inside ? joinPath(root, found.inside) : root
}

export async function diskPathOf(path: string): Promise<string> {
  return mountOf(path) ? ((await workingPath(path).catch(() => null)) ?? path) : path
}

export async function workingFolder(path: string): Promise<string | null> {
  const found = mountOf(path)
  const entry = found?.inside ? await found.mount.folder.at(found.inside) : null
  return workingPath(entry && !entry.key ? path : (found?.mount.root ?? path))
}

async function kept(mount: Mounted): Promise<void> {
  const root = workFolderOf(mount.folder.name)
  if (await crate<boolean>('path_taken', { path: root }).catch(() => false)) keep(mount)
}

export async function keepWorking(root?: string): Promise<void> {
  const found = root === undefined ? null : mountOf(root)
  for (const mount of found ? [found.mount] : root === undefined ? mounts() : []) {
    await kept(mount)
  }
}

export async function letGoWorking(folder: string, then?: 'gone') {
  const one = held.get(folder)
  held.delete(folder)
  if (one) {
    one.stop.abort()
    await one.done
  }
  if (then === 'gone') {
    await crate('delete_folder', { path: workFolderOf(folder) }).catch(() => undefined)
  }
}

export async function movedWorking(from: string, to: string, root: string) {
  const was = workFolderOf(from)
  if (!(await crate<boolean>('path_taken', { path: was }).catch(() => false))) return
  await crate('rename_note', { from: was, to: workFolderOf(to) }).catch(() => undefined)
  await keepWorking(root)
}
