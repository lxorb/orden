/** The space folders as another program changes them, heard by the engine
 *  (docs/sync-v2.md section 5.5).
 *
 *  The crate watches each space's folder and lists it once as the watch starts
 *  (src-tauri/src/space_watch.rs, space-watch.ts here). A file whose words are not Orden's
 *  last write was changed by something else and is folded in three ways (ingest.ts); a
 *  file nobody made here is a create, one gone is a delete, one that moved - the same
 *  file at a new path - is a move. Read a hundred at a time, a tick apart, so a `git
 *  checkout` of another branch never holds the window up.
 *
 *  Not what Orden did itself (#1068): the file list's moves and deletes are said to the
 *  engine before the disk has them (`moving` in engine.ts), and the engine's own are in
 *  its tree before they are on the disk, so whatever is heard about a path where the
 *  tree and the disk do not agree yet is that work under way, and nothing to read
 *  (`ownWork`). Every change is read against the disk as it is now, not as the message
 *  says it was: a message comes a moment late, and the path may have been taken again
 *  since. A folder that is not there any more is never read as a reason to delete
 *  anything: a space renamed in Explorer is gone from here too, and it is the workspace
 *  that says what became of it. */

import {
  scanSpace,
  type SpaceChange,
  type SpaceNews,
  unwatchSpaces,
  watchSpaces,
} from '../space-watch'
import { carriedOwn } from '@orden/bases/inbox'
import { hearInternal, listInternal } from '../internal/watch'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { t } from '../i18n.svelte'
import { syncMark } from '../surfaces.svelte'
import type { Engine } from './engine'
import { holdsDocument } from './kinds'
import { kindOfName } from './create'
import { relative } from './engine'

/** How many changes one tick reads. */
const BATCH = 100

/** Whether a path is the app's own (a dotted file or folder) rather than the person's.
 *  Bar the space's own inbox (`carriedOwn`, #1044), which is hidden from every list and
 *  carried all the same; the crate's walk and watch report it for the same reason. */
function hidden(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/')
  const name = parts.at(-1) ?? ''
  return parts.some(
    (part, at) => part.startsWith('.') && !(at === parts.length - 1 && carriedOwn(name)),
  )
}

/** Whether a path is another sync tool's copy, which the engine never keeps
 *  (@orden/sync-core/foreign). Hearing one is what fetches the mark the file list gives
 *  it, once. */
function foreign(path: string): boolean {
  if (!inForeignCopy(path)) return false
  void syncMark.ask()
  return true
}

/** Whether a path is something the engine keeps: a folder, a document, or - where the
 *  world carries bytes - any other file (files.ts). */
function kept(engine: Engine, path: string, dir: boolean): boolean {
  if (hidden(path) || foreign(path)) return false
  return dir || holdsDocument(kindOfName(path)) || !!engine.core.world.blobs
}

/** Whether this run has said the system's limit of watched folders is reached. */
let toldOfLimit = false

/** Says once a run, as a notification, that changes other programs make may go unheard:
 *  past the system's limit of watched folders, nothing past it is watched (#481). The
 *  spaces are still read again at every scan, which the window asks for. */
function limitReached(): void {
  if (toldOfLimit) return
  toldOfLimit = true
  void import('../notify').then(({ notify }) =>
    notify(
      t('Some changes may not be noticed'),
      t(
        'The system’s limit on watched folders is reached, so Orden may not notice every change other programs make in your spaces. Raising fs.inotify.max_user_watches fixes it.',
      ),
      'watch-limit',
    ),
  )
}

export interface Watching {
  engine: Engine
  /** Whether a space's first pass is done, so its folder can be read against its tree. */
  ready(spaceId: string): boolean
  /** Something changed that a pass should send. */
  changed(): void
  /** Another program moved or renamed a file or a folder the engine keeps, and the
   *  engine has it there now: said to everything this device keeps by path - its tabs,
   *  where each note was being read, the folders standing open - so they follow the
   *  entry, as they follow a move made in Orden (#1068). */
  moved?(from: string, to: string, kind: 'file' | 'folder'): Promise<void>
}

/** The watch, and the two things asked of it. */
export interface Watched {
  /** Watches the spaces the engine keeps now, where they are not the ones it watches:
   *  a space paired after the watch began - every space, on a device's first v2 launch -
   *  or one whose folder moved. */
  follow(): void
  stop(): void
}

/** Watches every space the engine keeps. */
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

  const heard = (news: SpaceNews) => {
    if (news.unwatched === 'limit') limitReached()
    if (news.gone) return
    if (news.scan) queue.push(() => scanned(how, news.root))
    for (const change of news.changes) queue.push(() => changed(how, change))
    void drain()
  }

  // A space Orden keeps itself is heard from its own folder, which says every change
  // exactly, and read whole once as it is first heard, for whatever changed before
  // (#1068). Its root is none of the crate's to watch: nothing is at it on the disk.
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
      if (!stop) continue
      inside.set(root, stop)
      heard({ root, changes: [], scan: true, gone: false })
    }
  }

  // The roots watched, said as one string so a follow that changes nothing does nothing.
  let watched: string | null = null
  const follow = () => {
    if (stopped) return
    const all = [...how.engine.core.spaces.values()].map((space) => space.row.root).sort()
    hearInside(all)
    const roots = all.filter((root) => !inside.has(root))
    const said = JSON.stringify(roots)
    if (said === watched) return
    watched = said
    // A watch the crate refused is asked for again at the next follow.
    void watchSpaces(roots, heard).catch(() => {
      if (watched === said) watched = null
    })
  }
  follow()
  return {
    follow,
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
  const disk = engine.core.world.disk
  if (change.kind === 'renamed') {
    if (!kept(engine, change.path, change.dir)) return
    // Respelled on a disk that does not tell case apart: one file, at both names.
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
    // Half of it is all that is still so: what went, or what came.
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
  if (change.kind === 'created') await came(engine, change.path, change.dir)
}

/** A path heard to have gone: a delete, where it is gone and was nobody's doing here. */
async function gone(engine: Engine, path: string): Promise<void> {
  if (engine.ownWork(path) || !engine.entryAt(path)) return
  if (await engine.core.world.disk.exists(path)) return
  await engine.removed(path)
}

/** A path heard to have come: a file made, where it is there and nobody's doing here. */
async function came(engine: Engine, path: string, dir: boolean): Promise<void> {
  if (engine.ownWork(path) || engine.entryAt(path)) return
  if (!(await engine.core.world.disk.exists(path))) return
  await made(engine, path, dir)
}

/** Whether the tree already has a folder where `path` is: the engine makes one on this
 *  disk a moment before it writes down where (a note moving into a folder another
 *  device made, places.ts `settle`), and hearing that back is its own echo, never a
 *  second folder of the same name. */
function wantedFolder(engine: Engine, path: string): boolean {
  const placed = engine.placed(path)
  if (!placed) return false
  const { space } = placed
  const key = space.key(placed.path)
  for (const [id, want] of space.paths()) {
    if (space.key(want) === key && space.entries.get(id)?.kind === 'folder') return true
  }
  return false
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

/** A space's folder read whole against its tree: what changed while Orden was not
 *  watching - closed, or the watcher having lost events. */
async function scanned(how: Watching, root: string): Promise<void> {
  const engine = how.engine
  const space = [...engine.core.spaces.values()].find((one) => one.row.root === root)
  if (!space || !how.ready(space.id)) return
  const listed = (await listInternal(root)) ?? (await scanSpace(root))
  const seen = new Set<string>()

  for (const one of listed) {
    const inside = relative(root, one.path)
    if (inside === null || !kept(engine, inside, one.dir)) continue
    seen.add(space.key(inside))
    const entry = space.at(inside)
    if (!entry) {
      if (!engine.ownWork(one.path)) await made(engine, one.path, one.dir)
    } else if (!one.dir && (entry.mtime !== one.mtime || entry.size !== one.size)) {
      await engine.foreign(one.path)
      // Read once: the next launch reads it again only if it changed again.
      await engine.stamped(one.path, one.mtime, one.size)
    }
  }

  // Deleted while Orden was closed: the entries whose files the folder no longer has.
  // Asked of the disk once more first: a pass may have moved a file since the listing.
  for (const entry of [...space.entries.values()]) {
    if (!entry.local_path || entry.deleted || seen.has(space.key(entry.local_path))) continue
    if (hidden(entry.local_path) || inForeignCopy(entry.local_path)) continue
    const full = engine.core.world.join(root, entry.local_path)
    if (engine.ownWork(full) || (await engine.core.world.disk.exists(full))) continue
    await engine.removed(full)
  }
}
