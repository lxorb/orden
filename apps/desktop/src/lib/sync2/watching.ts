import {
  scanSpace,
  type SpaceChange,
  type SpaceNews,
  unwatchSpaces,
  watchSpaces,
} from '../space-watch'
import { carriedOwn } from '@orden/bases/inbox'
import { keptShaped } from '../internal/roots'
import { hearInternal, listInternal, mountedFor } from '../internal/watch'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { samePath } from '../space-paths'
import { syncMark } from '../surfaces.svelte'
import type { Engine } from './engine'
import { holdsDocument } from './kinds'
import { kindOfName } from './create'
import { relative } from './engine'
import { madeTwice } from './twins'

const BATCH = 100

function hidden(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/')
  const name = parts.at(-1) ?? ''
  return parts.some(
    (part, at) => part.startsWith('.') && !(at === parts.length - 1 && carriedOwn(name)),
  )
}

function foreign(path: string): boolean {
  if (!inForeignCopy(path)) return false
  void syncMark.ask()
  return true
}

export function kept(engine: Engine, path: string, dir: boolean): boolean {
  const inside = [...engine.core.spaces.values()]
    .map((space) => relative(space.row.root, path, engine.core.world.foldsCase))
    .find((one) => one !== null)
  if (hidden(inside ?? path) || foreign(path)) return false
  return dir || holdsDocument(kindOfName(path)) || !!engine.core.world.blobs
}

let toldOfLimit = false

function limitReached(): void {
  if (toldOfLimit) return
  toldOfLimit = true
  void import('../notify').then(({ notify }) =>
    notify(
      'Some changes may not be noticed',
      'The system’s limit on watched folders is reached, so Orden may not notice every change other programs make in your spaces. Raising fs.inotify.max_user_watches fixes it.',
      'watch-limit',
    ),
  )
}

export interface Watching {
  engine: Engine
  ready(spaceId: string): boolean
  changed(): void
  moved?(from: string, to: string, kind: 'file' | 'folder'): Promise<void>
}

export interface Watched {
  follow(): void
  caughtUp(spaceId: string): void
  stop(): void
}

function spaceAt(engine: Engine, root: string) {
  return [...engine.core.spaces.values()].find((one) => samePath(one.row.root, root))
}

export function watchFolders(how: Watching): Watched {
  const queue: (() => Promise<void>)[] = []
  let draining = false
  let stopped = false

  const drain = async () => {
    if (draining) return
    draining = true
    try {
      while (queue.length && !stopped) {
        const batch = queue.splice(0, BATCH)
        for (const one of batch) await one().catch(() => undefined)
        how.changed()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      draining = false
    }
  }

  const missed = new Set<string>()
  const started = new Set<string>()
  const behind = (id: string | undefined) => {
    if (id !== undefined && !how.ready(id)) missed.add(id)
  }

  const heard = (news: SpaceNews) => {
    if (news.unwatched === 'limit') limitReached()
    if (news.gone) return
    if (news.scan) {
      const again = started.has(news.root)
      started.add(news.root)
      queue.push(() => {
        if (again) behind(spaceAt(how.engine, news.root)?.id)
        return scanned(how, news.root)
      })
    }
    for (const change of news.changes) {
      queue.push(() => {
        behind(how.engine.placed(change.path)?.space.id)
        return changed(how, change)
      })
    }
    void drain()
  }

  const inside = new Map<string, () => void>()
  const hearInside = (roots: readonly string[]) => {
    for (const [root, stop] of inside) {
      if (roots.includes(root)) continue
      stop()
      inside.delete(root)
    }
    for (const root of roots) {
      if (inside.has(root)) continue
      const stop = hearInternal(root, (changes) => {
        heard({ root, changes, scan: false, gone: false })
      })
      if (!stop) {
        if (keptShaped(root)) void mountedFor(root).then((yes) => yes && follow())
        continue
      }
      inside.set(root, stop)
      heard({ root, changes: [], scan: true, gone: false })
    }
  }

  let watched: string | null = null
  const follow = () => {
    if (stopped) return
    const all = [...how.engine.core.spaces.values()].map((space) => space.row.root).sort()
    hearInside(all)
    const roots = all.filter((root) => !inside.has(root) && !keptShaped(root))
    const said = JSON.stringify(roots)
    if (said === watched) return
    watched = said
    void watchSpaces(roots, heard).catch(() => {
      if (watched === said) watched = null
    })
  }
  follow()
  return {
    follow,
    caughtUp: (spaceId) => {
      const root = how.engine.core.spaces.get(spaceId)?.row.root
      if (!missed.delete(spaceId) || root === undefined) return
      queue.push(() => scanned(how, root))
      void drain()
    },
    stop: () => {
      stopped = true
      for (const stop of inside.values()) stop()
      inside.clear()
      void unwatchSpaces().catch(() => undefined)
    },
  }
}

async function changed(how: Watching, change: SpaceChange): Promise<void> {
  const engine = how.engine
  const placed = engine.placed(change.path)
  if (placed && !how.ready(placed.space.id)) return
  const disk = engine.core.world.disk
  if (change.kind === 'renamed') {
    if (!kept(engine, change.path, change.dir)) return
    const entry = engine.entryAt(change.from)
    const respelled = entry !== null && entry === engine.entryAt(change.path)
    const left = respelled || !(await disk.exists(change.from))
    const there = await disk.exists(change.path)
    if (left && there && !engine.ownWork(change.from) && !engine.ownWork(change.path)) {
      if (entry) {
        await engine.moved(change.from, change.path)
        await how.moved?.(change.from, change.path, change.dir ? 'folder' : 'file')
        return
      }
    }
    if (left) await gone(engine, change.from)
    if (there) await came(engine, change.path, change.dir)
    return
  }
  if (!kept(engine, change.path, change.dir)) return
  if (change.kind === 'removed') {
    await gone(engine, change.path)
    return
  }
  if (engine.entryAt(change.path)) {
    if (!change.dir) await engine.foreign(change.path)
    return
  }
  if (change.kind === 'created' || !change.dir) await came(engine, change.path, change.dir)
}

async function gone(engine: Engine, path: string): Promise<void> {
  if (engine.ownWork(path) || !engine.entryAt(path)) return
  if (await engine.core.world.disk.exists(path)) return
  await engine.removed(path)
}

async function came(engine: Engine, path: string, dir: boolean): Promise<void> {
  if (engine.ownWork(path) || engine.entryAt(path)) return
  if (!(await engine.core.world.disk.exists(path))) return
  await made(engine, path, dir)
}

function wantedFolder(engine: Engine, path: string): boolean {
  const placed = engine.placed(path)
  if (!placed) return false
  const { space } = placed
  return space.wantedAt(placed.path).some((id) => space.entries.get(id)?.kind === 'folder')
}

async function made(engine: Engine, path: string, dir: boolean) {
  if (dir && wantedFolder(engine, path)) return
  if (dir || !holdsDocument(kindOfName(path))) {
    await engine.created(path, dir)
    return
  }
  const text = await engine.core.world.disk.read(path)
  if (text !== null) await engine.created(path, dir, text)
}

export async function scanned(how: Watching, root: string): Promise<void> {
  const engine = how.engine
  const space = spaceAt(engine, root)
  if (!space || !how.ready(space.id)) return
  const listed = (await listInternal(root)) ?? (keptShaped(root) ? null : await scanSpace(root))
  if (!listed) return
  const seen = new Set<string>()
  const unread: string[] = []

  for (const one of listed) {
    const inside = relative(root, one.path, engine.core.world.foldsCase)
    if (inside === null) continue
    if (one.unlisted) unread.push(`${space.key(inside)}/`)
    if (!kept(engine, inside, one.dir)) continue
    seen.add(space.key(inside))
    const entry = space.at(inside)
    if (!entry) {
      if (!engine.ownWork(one.path)) await made(engine, one.path, one.dir)
    } else if (!one.dir && (entry.mtime !== one.mtime || entry.size !== one.size)) {
      await engine.foreign(one.path)
      await engine.stamped(one.path, one.mtime, one.size)
    }
  }

  for (const entry of [...space.entries.values()]) {
    if (!entry.local_path || entry.deleted || seen.has(space.key(entry.local_path))) continue
    if (hidden(entry.local_path) || inForeignCopy(entry.local_path)) continue
    if (unread.some((folder) => space.key(entry.local_path).startsWith(folder))) continue
    const full = engine.core.world.join(root, entry.local_path)
    if (engine.ownWork(full) || (await engine.core.world.disk.exists(full))) continue
    await engine.removed(full)
  }

  const disk = engine.core.world.disk
  for (const twin of madeTwice(space)) {
    const from = engine.core.world.join(root, twin.from)
    const to = engine.core.world.join(root, twin.to)
    if (engine.ownWork(from) || (await disk.exists(to)) || !(await disk.exists(from))) continue
    await engine.moving(from, to, () => disk.move(from, to, 'file'))
    await how.moved?.(from, to, 'file')
  }
}
