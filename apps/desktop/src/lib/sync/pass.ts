import { carriedOwn, INBOX_PATH, withTasksOf } from '@orden/bases/inbox'
import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@orden/markdown/links'
import { conflictPath } from '@orden/markdown/paths'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { hash32 } from '@orden/sync-core/seed'
import { isEntryId } from '@orden/sync-core/wire'
import { api, ApiError, type RemoteNote, type SpaceFile } from '../api'
import { sha256 } from '../bytes'
import { evictedHere } from '../icloud-placeholder'
import { log } from '../log'
import { without } from '../records'
import { isNumber, isRecord, isString } from '../stored'
import { folderOf, insideSpace, nameOf, relativeTo, samePath } from '../space-paths'
import { syncMark } from '../surfaces.svelte'
import { invoke, joinPath } from '../tauri'
import { settleShortcuts } from '../web-tab/settle'
import { isUntouchedWelcome } from '../welcome'
import { syncDeletes } from './deletes'
import { baseOf, behind, unixLines } from './ancestry'
import { type Clash, type ConflictRule, DEFAULT_RULE } from './conflicts'
import {
  fileStamp,
  type Mirror,
  type Moving,
  type Tracked,
  type TrackedFile,
  within,
} from './mirror'
import { type Folded, foldWebCopies } from './web-copies'
import { NotWritten, writeDown } from './write-down'
import type { Entry } from '../workspace.svelte'

function ordered<T extends { path: string }>(
  notes: readonly T[],
  wanted: ReadonlySet<string> | undefined,
): readonly T[] {
  if (!wanted?.size) return notes

  const first = notes.filter((one) => wanted.has(one.path))
  if (!first.length) return notes

  return [...first, ...notes.filter((one) => !wanted.has(one.path))]
}

function placeable(path: string): boolean {
  if (!path || /^[a-zA-Z]:/.test(path) || /^[\\/]/.test(path)) return false

  return path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
}

async function holdsSameWords(local: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(local)) === hash) return true
  if (!local.includes('\r')) return false

  return (await sha256(unixLines(local))) === hash
}

async function settled(
  path: string,
  ours: string,
  theirs: string,
  theirsNewer: () => Promise<boolean>,
): Promise<string | null> {
  if (isCanvasTarget(path) || isPagesTarget(path)) {
    return (await import('@orden/markdown/canvas-merge')).mergeCanvasFiles(ours, theirs)
  }

  if (isWebTarget(path)) return settleShortcuts(path, ours, theirs, await theirsNewer())

  return null
}

async function theirsIsNewer(path: string, updatedAt: number): Promise<boolean> {
  const stamp = await fileStamp(path)
  return stamp === null || updatedAt > stamp.modified
}

async function ownNotes(root: string, tree: Entry): Promise<Entry[]> {
  const path = insideSpace(root, INBOX_PATH)
  if (flatten(tree).some((one) => samePath(one.path, path))) return []
  const there = await invoke<string>('read_note', { path }).then(
    () => true,
    () => false,
  )
  if (!there) return []
  const modified = (await fileStamp(path))?.modified ?? 0
  return [{ name: nameOf(path), path, is_dir: false, modified, created: modified, children: [] }]
}

function flatten(entry: Entry): Entry[] {
  const out: Entry[] = []
  const walk = (node: Entry) => {
    for (const child of node.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  walk(entry)
  return out
}

function unlistedIn(entry: Entry): Entry[] {
  return entry.children.flatMap((child) =>
    child.is_dir ? [...(child.unlisted ? [child] : []), ...unlistedIn(child)] : [],
  )
}

function underUnread(path: string, unread: readonly string[]): boolean {
  return unread.some((folder) => samePath(path.slice(0, folder.length), folder))
}

export interface Joined {
  has(id: string): boolean
}

export interface Waiting {
  listed?: (paths: string[]) => void
  wrote?: (path: string) => void
  notWritten?: (path: string) => void
  save?: () => void
  moved?: (from: string, to: string) => void | Promise<void>
  holdingWrites?: <T>(from: string, run: () => Promise<T>, stalled: () => Promise<T>) => Promise<T>
  wanted?: ReadonlySet<string>
  rule?: ConflictRule
  clashed?: (clash: Clash) => void
  held?: ReadonlySet<string>
  asked?: ReadonlySet<string>
  kept?: (path: string) => boolean
}

export async function pull(
  mirror: Mirror,
  token: string,
  joined: Joined,
  waiting?: Waiting,
): Promise<boolean> {
  const root = mirror.root
  let moved = false
  await journalled(mirror)
  if (await toldAgain(mirror, token, waiting?.asked, waiting?.clashed)) moved = true

  let since = mirror.cursor
  let holding = false
  const unsettledHere = new Set<string>()
  for (;;) {
    const page = await api.changes(token, mirror.spaceId, since)
    if (page.notes.length) moved = true

    waiting?.listed?.(
      page.notes
        .filter((one) => !one.deleted && placeable(one.path) && !inForeignCopy(one.path))
        .map((one) => joinPath(root, one.path)),
    )

    const notes = ordered(page.notes, waiting?.wanted)
    const carried = (one: RemoteNote) => placeable(one.path) && !inForeignCopy(one.path)

    const known = new Map(Object.entries(mirror.notes).map(([path, one]) => [one.id, path]))
    const named = new Set(notes.filter((one) => !one.deleted).map((one) => one.path))
    const untold = (one: RemoteNote) => mirror.untold?.[one.id] !== undefined
    for (const remote of notes) {
      if (!remote.deleted || !carried(remote) || untold(remote)) continue
      const target = joinPath(root, remote.path)
      const here = known.get(remote.id) ?? remote.path
      const kept = waiting?.kept?.(target) === true
      await deletedThere(mirror, remote, here, joined, kept, named, waiting)
    }

    const places = new Map(Object.entries(mirror.notes).map(([path, one]) => [one.id, path]))
    const moves = notes.flatMap((remote) => {
      const was = places.get(remote.id)
      return !remote.deleted &&
        carried(remote) &&
        !untold(remote) &&
        was !== undefined &&
        was !== remote.path
        ? [{ remote, was }]
        : []
    })
    const halfDone = new Set(moves.length ? await movedThere(mirror, moves, waiting) : [])
    const held = notes.filter(untold).map((one) => one.id)
    const waits = new Set([...halfDone, ...held])
    for (const id of waits) unsettledHere.add(id)
    unsettled.set(mirror, unsettledHere)
    for (const [path, one] of Object.entries(mirror.notes)) {
      if (isAside(path) && !waits.has(one.id) && (await present(joinPath(root, path)))) {
        await shownAgain(mirror, path, one.id, named, waiting)
      }
    }

    for (const remote of notes) {
      try {
        if (!placeable(remote.path)) continue

        if (inForeignCopy(remote.path)) {
          if (remote.deleted && mirror.notes[remote.path]?.id === remote.id) {
            mirror.notes = without(mirror.notes, remote.path)
          }
          continue
        }

        const target = joinPath(root, remote.path)

        if (remote.deleted || waits.has(remote.id)) continue

        const tracked = mirror.notes[remote.path]
        if (tracked?.version === remote.version) continue
        const keep = (hash = remote.hash) => {
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash }
        }
        const wrote = () => {
          keep()
          waiting?.wrote?.(target)
        }

        const local = await invoke<string>('read_note', { path: target }).catch(() => null)

        if (local === null && tracked !== undefined) continue

        if (local === null && (await fileStamp(target)) !== null) {
          log('warn', `sync: ${target} unreadable, not written over`)
          continue
        }

        if (local !== null && (await holdsSameWords(local, remote.hash))) {
          wrote()
          continue
        }

        const { content } = await api.readNote(token, remote.id)

        const news =
          remote.hash !== tracked?.hash &&
          !(remote.hash && remote.hash === mirror.offered[remote.path]) &&
          !(tracked === undefined && mirror.dropped)

        const diverged =
          local !== null &&
          news &&
          !joined.has(remote.id) &&
          !isUntouchedWelcome(remote.path, local) &&
          (tracked === undefined
            ? !(await onlyBehind(token, remote.id, local))
            : !(await holdsSameWords(local, tracked.hash)))

        if (!news && local !== null && local !== content) {
          keep()
          continue
        }

        if (diverged && local !== content) {
          const together = await settled(remote.path, local, content, () =>
            theirsIsNewer(target, remote.updatedAt),
          )

          if (together !== null) {
            await writeDown(target, together, local)
            wrote()
            continue
          }

          const merged = tracked
            ? await mergedOver(token, target, remote.id, tracked.hash, local, content)
            : null
          if (merged !== null) {
            await writeDown(target, merged, local)
            wrote()
            continue
          }

          if (carriedOwn(remote.path)) {
            await writeDown(target, withTasksOf(local, content), local)
            wrote()
            continue
          }

          const rule = waiting?.rule ?? DEFAULT_RULE

          if (rule === 'ask') {
            waiting?.clashed?.({
              path: target,
              id: remote.id,
              version: remote.version,
              theirs: content,
              at: Date.now(),
            })

            keep('')
            continue
          }

          if (rule === 'newest' && (await theirsIsNewer(target, remote.updatedAt))) {
            await writeDown(target, content, local)
            wrote()
            continue
          }

          if (rule === 'both') await writeDown(conflictPath(target), content)

          wrote()
          continue
        }

        await writeDown(target, content, local)
        wrote()
      } catch (error) {
        if (!(error instanceof NotWritten)) throw error
        log('warn', `sync: ${remote.path} not written - ${error.message}`)
        waiting?.notWritten?.(remote.path)
        holding = true
      }
    }

    if (halfDone.size) break
    if (held.length) holding = true

    const asked = since
    since = page.cursor
    if (!holding) mirror.cursor = page.cursor
    if (!page.more || page.cursor === asked) break
  }

  return moved
}

async function movedThere(
  mirror: Mirror,
  moves: readonly { remote: RemoteNote; was: string }[],
  waiting?: Waiting,
): Promise<Set<string>> {
  const full = (path: string) => joinPath(mirror.root, path)
  const pending: { id: string; was: string; at: string | null; now: string }[] = []

  for (const { remote, was } of moves) {
    if (mirror.notes[was]?.id !== remote.id) continue

    const aside = isAside(was) ? null : await asideFound(mirror.root, was, remote.id)
    let at: string | null = null
    if (aside !== null) {
      rekey(mirror, was, aside)
      at = aside
    } else if (await present(full(was))) {
      at = was
    }
    pending.push({ id: remote.id, was, at, now: remote.path })
  }

  const move = async (one: (typeof pending)[number], to: string): Promise<boolean> => {
    const from = one.at
    if (from === null) return false
    mirror.moving = { id: one.id, from, to }
    waiting?.save?.()
    const renamed = async () => {
      const done = await invoke('rename_note', {
        from: full(from),
        to: full(to),
        arrived: true,
      }).then(
        () => true,
        (error: unknown) => {
          log('warn', `sync: ${full(from)} not moved to ${full(to)} - ${String(error)}`)
          return false
        },
      )
      if (done) {
        rekey(mirror, from, to)
        one.at = to
      }
      delete mirror.moving
      waiting?.save?.()
      if (done) await waiting?.moved?.(full(from), full(to))
      return done
    }
    return waiting?.holdingWrites ? waiting.holdingWrites(full(from), renamed, renamed) : renamed()
  }

  const left = new Set(pending)
  const where = (one: (typeof pending)[number]) => one.at ?? one.was

  for (let round = 0; round <= 2 * pending.length && left.size; round += 1) {
    let progress = false
    for (const one of [...left]) {
      if (mirror.notes[one.now]) continue
      const from = where(one)
      if (one.at === null) {
        rekey(mirror, from, one.now)
      } else if (!(await move(one, one.now))) {
        continue
      }
      left.delete(one)
      progress = true
    }
    if (progress) continue

    const holder = [...left].find(
      (one) =>
        one.at !== null &&
        !isAside(one.at) &&
        [...left].some((other) => other !== one && other.now === one.at),
    )
    if (!holder?.at || !(await move(holder, asideOf(holder.at, holder.id)))) break
  }

  const waits = new Set<string>()
  for (const one of left) {
    const tied = pending.some(
      (other) => other !== one && (other.was === one.now || other.now === one.was),
    )
    if (one.at !== null && isAside(one.at) && !mirror.notes[one.was]) {
      if (!(await present(full(one.was)))) await move(one, one.was)
    }
    if (tied) {
      waits.add(one.id)
      continue
    }

    const at = where(one)
    if (isAside(at)) await shownAgain(mirror, at, one.id, new Set(), waiting)
    const now = Object.keys(mirror.notes).find((path) => mirror.notes[path]?.id === one.id)
    if (now !== undefined) {
      mirror.notes = without(mirror.notes, now)
      mirror.offered = without(mirror.offered, now)
    }
  }
  return waits
}

function rekey(mirror: Mirror, from: string, to: string) {
  const tracked = mirror.notes[from]
  if (!tracked || from === to) return
  const offered = mirror.offered[from]
  mirror.notes = { ...without(mirror.notes, from), [to]: tracked }
  mirror.offered = without(mirror.offered, from)
  if (offered !== undefined) mirror.offered = { ...mirror.offered, [to]: offered }
}

const ASIDE = '.orden-moving-'
const ASIDES = [ASIDE, '.nib-moving-']

function asidePrefix(id: string, aside = ASIDE): string {
  return `${aside}${hash32(id).toString(36)}-`
}

export function asideOf(path: string, id: string): string {
  const folder = folderOf(path)
  return `${folder ? `${folder}/` : ''}${asidePrefix(id)}${nameOf(path)}`
}

export function nameSetAside(aside: string, id: string): string {
  const name = nameOf(aside)
  for (const aside of ASIDES) {
    for (const prefix of [asidePrefix(id, aside), `${aside}${id}-`]) {
      if (name.startsWith(prefix)) return name.slice(prefix.length)
    }
  }
  const found = ASIDES.find((one) => name.startsWith(one)) ?? ASIDE
  return name.slice(found.length)
}

async function asideFound(root: string, path: string, id: string): Promise<string | null> {
  const folder = folderOf(path) ? `${folderOf(path)}/` : ''
  const places = ASIDES.flatMap((aside) => [
    `${folder}${asidePrefix(id, aside)}${nameOf(path)}`,
    ...(isEntryId(id) ? [`${folder}${aside}${id}-${nameOf(path)}`] : []),
  ])
  for (const at of places) {
    if (await present(joinPath(root, at))) return at
  }
  return null
}

function isAside(path: string): boolean {
  return ASIDES.some((aside) => nameOf(path).startsWith(aside))
}

async function present(path: string): Promise<boolean> {
  const read = await invoke<string>('read_note', { path }).then(
    () => true,
    () => false,
  )
  return read || (await fileStamp(path)) !== null
}

async function shownAgain(
  mirror: Pick<Mirror, 'root' | 'notes' | 'offered'>,
  aside: string,
  id: string,
  avoid: ReadonlySet<string>,
  waiting?: Waiting,
): Promise<string> {
  const full = (path: string) => joinPath(mirror.root, path)
  const name = nameSetAside(aside, id)
  const folder = folderOf(aside)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  for (let n = 1; n < 100; n += 1) {
    const path = `${folder ? `${folder}/` : ''}${n === 1 ? name : `${stem} ${n}${ext}`}`
    const theirs = mirror.notes[path] && mirror.notes[path].id !== id
    if (avoid.has(path) || theirs || (await present(full(path)))) continue
    const done = await invoke('rename_note', {
      from: full(aside),
      to: full(path),
      arrived: true,
    }).then(
      () => true,
      () => false,
    )
    if (!done) break
    if (mirror.notes[aside]) rekey(mirror as Mirror, aside, path)
    await waiting?.moved?.(full(aside), full(path))
    return path
  }
  log('warn', `sync: ${full(aside)} could not be put back in sight`)
  return aside
}

async function journalled(mirror: Mirror): Promise<void> {
  const moving = mirror.moving
  if (!moving) return
  delete mirror.moving
  if (mirror.notes[moving.from]?.id !== moving.id || mirror.notes[moving.to]) return

  const full = (path: string) => joinPath(mirror.root, path)
  if (!(await present(full(moving.from))) && (await present(full(moving.to)))) {
    rekey(mirror, moving.from, moving.to)
  }
}

export async function asidesBack(
  root: string,
  notes: Readonly<Record<string, Tracked>>,
  moving?: Moving,
): Promise<Record<string, Tracked>> {
  const record = { root, notes: { ...notes }, offered: {}, ...(moving ? { moving } : {}) }
  await journalled(record as Mirror)
  for (const path of Object.keys(record.notes)) {
    if (isAside(path) && (await present(joinPath(root, path)))) {
      await shownAgain(record, path, record.notes[path]?.id ?? '', new Set())
    }
  }
  return record.notes
}

const unsettled = new WeakMap<Mirror, ReadonlySet<string>>()

async function onlyBehind(token: string, id: string, local: string): Promise<boolean> {
  const hashes = [await sha256(local)]
  if (local.includes('\r')) hashes.push(await sha256(unixLines(local)))

  const found = await behind(
    token,
    hashes.map((hash) => ({ id, hash })),
  )
  return found.has(id)
}

async function mergedOver(
  token: string,
  path: string,
  id: string,
  base: string,
  local: string,
  remote: string,
): Promise<string | null> {
  if (__EVEN_PLUGIN__) return null

  const ancestor = await baseOf(token, path, id, base)
  if (ancestor === null) return null

  const { mergedCleanly } = await import('./merging')
  return mergedCleanly(ancestor, unixLines(local), remote)
}

async function deletedThere(
  mirror: Mirror,
  remote: RemoteNote,
  here: string,
  joined: Joined,
  kept: boolean,
  named: ReadonlySet<string>,
  waiting?: Waiting,
) {
  const tracked = mirror.notes[here]
  if (tracked && tracked.id !== remote.id) return

  mirror.offered = without(mirror.offered, remote.path)
  if (!tracked) return

  const path = isAside(here) ? await shownAgain(mirror, here, remote.id, named, waiting) : here
  mirror.offered = without(mirror.offered, path)
  mirror.notes = without(mirror.notes, path)
  const target = joinPath(mirror.root, path)

  const local = await invoke<string>('read_note', { path: target }).catch(() => null)
  if (local === null && (await fileStamp(target)) === null) return

  if (local === null || !(joined.has(remote.id) || (await holdsSameWords(local, tracked.hash)))) {
    log('info', `sync: ${target} was deleted elsewhere after it was written in here, so it stays`)
    return
  }

  if (kept) {
    log('info', `sync: ${target} was deleted elsewhere and is archived here, so it stays`)
    return
  }

  await invoke('snapshot_note', { path: target, content: local }).catch(() => undefined)
  const how = syncDeletes(target, 'file')
    ? invoke('delete_note', { path: target })
    : invoke('trash_item', { path: target, kind: 'note' })
  await how.catch((error: unknown) => {
    log(
      'warn',
      `sync: ${target} was deleted elsewhere and stays, the trash refused it - ${String(error)}`,
    )
  })
}

export async function movedHere(
  mirror: Mirror,
  token: string,
  from: string,
  to: string,
  held: ReadonlySet<string> = new Set(),
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  const was = within(mirror.root, from)
  const now = within(mirror.root, to)
  if (was === null || now === null) return false

  const under = `${was}/`
  const moving = Object.entries(mirror.notes)
    .filter(([path, one]) => {
      if (path !== was && !path.startsWith(under)) return false
      const untold = mirror.untold?.[one.id]
      return !untold || untold.to === now + path.slice(was.length)
    })
    .map(([path]) => path)

  let done = false
  for (const [id, one] of Object.entries(mirror.untold ?? {})) {
    if (one.to !== was && !one.to.startsWith(under)) continue
    const to = now + one.to.slice(was.length)
    if (to === one.from) told(mirror, id)
    else mirror.untold = { ...mirror.untold, [id]: { ...one, to } }
    done = true
  }

  for (const path of moving) {
    const to = now + path.slice(was.length)
    if (await movedOne(mirror, token, path, to, held, clashed)) done = true
  }

  return done
}

async function toldAgain(
  mirror: Mirror,
  token: string,
  asked: ReadonlySet<string> = new Set(),
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  let done = false
  for (const [id, one] of Object.entries(mirror.untold ?? {})) {
    done = true
    if (mirror.notes[one.from]?.id !== id) {
      told(mirror, id)
      continue
    }
    const at = joinPath(mirror.root, one.from)
    if (!(await present(joinPath(mirror.root, one.to)))) {
      const words = await invoke<string>('read_note', { path: at }).catch(() => null)
      if (words === null && !(await present(at))) {
        told(mirror, id)
        continue
      }
      if (words !== null && (await sha256(words)) === mirror.notes[one.from]?.hash) {
        told(mirror, id)
        continue
      }
      if (words === null || asked.has(id)) continue
      const refused = await api.deleteNote(token, id).then(
        () => null,
        (error: unknown) => error,
      )
      if (refused !== null && !isGone(refused)) {
        untoldBy(mirror, id, one.from, one.to, refused)
        continue
      }
      mirror.notes = without(mirror.notes, one.from)
      mirror.offered = without(mirror.offered, one.from)
      told(mirror, id)
      continue
    }
    if (mirror.notes[one.to]) {
      letGo(mirror, id, one.from, one.to, 'its new name is another note')
      continue
    }

    const there = await api.readNote(token, id).catch((error: unknown) => error)
    if (!isRecord(there) || !isRecord(there.note)) {
      untoldBy(mirror, id, one.from, one.to, there)
      continue
    }
    if (there.note.deleted === true) {
      letGo(mirror, id, one.from, one.to, 'the account has deleted it')
      continue
    }
    if (there.note.path !== one.from && there.note.path !== one.to) {
      log('warn', `sync: ${one.to} was renamed on another device too, and takes that name`)
      rekey(mirror, one.from, one.to)
      told(mirror, id)
      continue
    }

    await movedOne(
      mirror,
      token,
      one.from,
      one.to,
      asked.has(id) ? new Set([id]) : new Set(),
      clashed,
    )
  }
  return done
}

function told(mirror: Mirror, id: string) {
  if (!mirror.untold?.[id]) return
  const left = without(mirror.untold, id)
  if (Object.keys(left).length) mirror.untold = left
  else delete mirror.untold
}

const MOST_TRIES = 5

const FAILING_FOR = 60 * 60_000

function untoldBy(mirror: Mirror, id: string, from: string, to: string, error: unknown) {
  const was = mirror.untold?.[id]
  const status = error instanceof ApiError ? error.status : null
  if (status === null || status === 401) {
    mirror.untold = { ...mirror.untold, [id]: { ...was, from, to, tries: was?.tries ?? 0 } }
    return
  }
  if (status >= 500 || status === 408 || status === 429) {
    const now = Date.now()
    const failing = { since: was?.failing?.since ?? now, times: (was?.failing?.times ?? 0) + 1 }
    if (now - failing.since >= FAILING_FOR && failing.times >= MOST_TRIES) {
      letGo(mirror, id, from, to, `the account kept failing - ${String(error)}`)
      return
    }
    mirror.untold = { ...mirror.untold, [id]: { from, to, tries: was?.tries ?? 0, failing } }
    return
  }
  const tries = (was?.tries ?? 0) + 1
  const forGood = status >= 400 && status !== 409
  if (forGood || tries >= MOST_TRIES) {
    letGo(mirror, id, from, to, `the account refused it - ${String(error)}`)
    return
  }
  mirror.untold = { ...mirror.untold, [id]: { from, to, tries } }
}

function letGo(mirror: Mirror, id: string, from: string, to: string, why: string) {
  told(mirror, id)
  if (mirror.notes[from]?.id !== id) return
  log('warn', `sync: the rename of ${from} to ${to} is given up on: ${why}`)
  mirror.notes = without(mirror.notes, from)
  mirror.offered = without(mirror.offered, from)
}

async function movedOne(
  mirror: Mirror,
  token: string,
  was: string,
  now: string,
  held: ReadonlySet<string>,
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  const tracked = mirror.notes[was]
  if (!tracked) return false
  if (inForeignCopy(now) && !inForeignCopy(was)) return false

  const content = await invoke<string>('read_note', {
    path: joinPath(mirror.root, now),
  }).catch(() => null)
  if (content === null) return false

  try {
    if (held.has(tracked.id)) {
      const moved = await heldMovedUpThere(token, tracked, now)
      clashed?.({
        path: joinPath(mirror.root, now),
        id: tracked.id,
        version: moved.tracked.version,
        theirs: moved.words,
        at: Date.now(),
      })
      mirror.notes = { ...without(mirror.notes, was), [now]: moved.tracked }
    } else {
      const moved = await renamedUpThere(token, tracked, now, content)
      mirror.notes = { ...without(mirror.notes, was), [now]: moved }
    }
  } catch (error) {
    untoldBy(mirror, tracked.id, was, now, error)
    return true
  }

  told(mirror, tracked.id)
  mirror.offered = without(mirror.offered, was)

  return true
}

async function heldMovedUpThere(
  token: string,
  tracked: Tracked,
  path: string,
): Promise<{ tracked: Tracked; words: string }> {
  const there = await api.readNote(token, tracked.id)
  const { note } = await api.writeNote(token, tracked.id, path, there.content, there.note.version)
  return {
    tracked: { id: note.id, version: note.version, hash: tracked.hash },
    words: there.content,
  }
}

async function renamedUpThere(
  token: string,
  tracked: Tracked,
  path: string,
  content: string,
): Promise<Tracked> {
  try {
    const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
    return { id: note.id, version: note.version, hash: note.hash }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
  }

  const held = await api.readNote(token, tracked.id)
  await api.writeNote(token, tracked.id, path, held.content, held.note.version)
  return tracked
}

export interface Sending {
  held?: ReadonlySet<string>
  asked?: ReadonlySet<string>
  sent?: (path: string) => void
  refused?: (path: string) => void
  folded?: (one: Folded) => void
}

const REFUSALS: ReadonlySet<number> = new Set([400, 413, 415, 422])

function refusesIt(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    REFUSALS.has(error.status) &&
    isRecord(error.body) &&
    isString(error.body.error)
  )
}

function isFull(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 507
}

interface Unplaced {
  path: string
  hash: string | null
  lines?: Set<string>
}

function linesOf(words: string): Set<string> {
  return new Set(
    words
      .split(/\r?\n/)
      .map((one) => one.trim())
      .filter(Boolean),
  )
}

async function wordsWaitIn(
  token: string,
  id: string,
  hash: string,
  unplaced: readonly Unplaced[],
): Promise<boolean> {
  if (!unplaced.length) return false
  if (unplaced.some((one) => one.hash === hash)) return true

  let lines: Set<string>
  try {
    lines = linesOf((await api.readNote(token, id)).content)
  } catch (error) {
    return !isGone(error)
  }
  if (!lines.size) return false

  for (const one of unplaced) {
    one.lines ??= linesOf(await invoke<string>('read_note', { path: one.path }).catch(() => ''))
    let shared = 0
    for (const line of lines) if (one.lines.has(line)) shared += 1
    if (shared * 2 >= lines.size) return true
  }
  return false
}

const NOTE_PATH = /\.(md|markdown|mdown|mkd|canvas|pages|url|webloc|chat)$/i

interface Refused {
  notes: Map<string, string>
  papers: Map<string, number>
  list: string | null
}
const refusals = new WeakMap<Mirror, Refused>()

function refusedOf(mirror: Mirror): Refused {
  const known = refusals.get(mirror)
  if (known) return known
  const fresh: Refused = { notes: new Map(), papers: new Map(), list: null }
  refusals.set(mirror, fresh)
  return fresh
}

function notInTheAir(mirror: Mirror, path: string, earlier: string | undefined) {
  mirror.offered =
    earlier === undefined ? without(mirror.offered, path) : { ...mirror.offered, [path]: earlier }
}

function noteRefused(
  mirror: Mirror,
  path: string,
  hash: string,
  error: unknown,
  earlier: string | undefined,
  sending: Sending,
) {
  log('warn', `sync: ${path} not taken - ${String(error)}`)
  refusedOf(mirror).notes.set(path, hash)
  notInTheAir(mirror, path, earlier)
  sending.refused?.(path)
}

export async function push(
  mirror: Mirror,
  token: string,
  joined: Joined,
  sending: Sending = {},
): Promise<boolean> {
  const held = sending.held ?? new Set<string>()
  const root = mirror.root
  const tree = await invoke<Entry>('read_tree', { root, options: { papers: true } }).catch(
    () => null,
  )
  if (!tree || tree.unlisted) return false
  const waits = unsettled.get(mirror) ?? new Set<string>()
  const unread = unlistedIn(tree).map((one) => `${relativeTo(root, one.path)}/`)

  const all = [...flatten(tree), ...(await ownNotes(root, tree))]
  const everything = all.filter((one) => !inForeignCopy(relativeTo(root, one.path)))
  if (!__EVEN_PLUGIN__ && everything.length < all.length) void syncMark.ask()
  const folded = await foldWebCopies(everything)
  for (const one of folded) sending.folded?.(one)
  const listed = everything.filter((one) => !folded.some((fold) => fold.gone === one.path))
  const seen = new Set<string>()
  let moved = folded.length > 0
  const untold = mirror.untold ?? {}
  const renamed = new Set(Object.values(untold).map((one) => one.to))

  let full: ApiError | null = null
  try {
    if (await pushFiles(mirror, root, listed, token, unread, sending)) moved = true
  } catch (error) {
    if (!isFull(error)) throw error
    full = error
  }

  const refused = refusedOf(mirror)
  const unplaced: Unplaced[] = []

  for (const file of listed.filter((one) => !isPdfTarget(one.name))) {
    const path = relativeTo(root, file.path)
    seen.add(path)

    if (held.has(file.path)) continue

    if (!NOTE_PATH.test(path)) {
      if (!refused.notes.has(path)) {
        noteRefused(mirror, path, '', 'not a kind sync v1 carries', mirror.offered[path], sending)
      }
      if (!mirror.notes[path]) unplaced.push({ path: file.path, hash: null })
      continue
    }

    const content = await invoke<string>('read_note', { path: file.path }).catch(
      (error: unknown) => {
        log('warn', `sync: ${file.path} not sent - ${String(error)}`)
        return null
      },
    )
    if (content === null) continue

    const hash = await sha256(content)
    const tracked = mirror.notes[path]
    if (tracked && waits.has(tracked.id)) continue
    if (tracked ? untold[tracked.id] : renamed.has(path)) continue
    if (refused.notes.get(path) === hash) {
      if (!tracked) unplaced.push({ path: file.path, hash })
      continue
    }

    if (!tracked) {
      if (isUntouchedWelcome(path, content)) continue

      if (full) {
        unplaced.push({ path: file.path, hash })
        continue
      }
      try {
        if (await create(mirror, token, path, content, sending)) moved = true
      } catch (error) {
        if (!isFull(error)) throw error
        full = error
      }
      if (!mirror.notes[path] && (full || refused.notes.get(path) === hash)) {
        unplaced.push({ path: file.path, hash })
      }
      continue
    }

    if (tracked.hash === hash) continue

    if (joined.has(tracked.id)) {
      continue
    }
    if (full) continue

    moved = true

    const earlier = mirror.offered[path]
    mirror.offered = { ...mirror.offered, [path]: hash }

    try {
      const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
      mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
      mirror.offered = without(mirror.offered, path)
      sending.sent?.(path)
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) continue
      if (refusesIt(error)) {
        noteRefused(mirror, path, hash, error, earlier, sending)
        continue
      }
      if (isFull(error)) {
        notInTheAir(mirror, path, earlier)
        full = error
        continue
      }
      if (!(error instanceof ApiError) || error.status !== 409) throw error

      if (joined.has(tracked.id) && caughtUpWith(mirror, path, error.body)) continue

      try {
        await keepBoth(mirror, path, tracked, error.body, token, tracked.hash)
      } catch (again) {
        if (again instanceof NotWritten) continue
        if (refusesIt(again)) {
          noteRefused(mirror, path, hash, again, earlier, sending)
          continue
        }
        if (isFull(again)) {
          full = again
          continue
        }
        if (!(again instanceof ApiError) || (again.status !== 409 && again.status !== 503)) {
          throw again
        }
      }
    }
  }

  for (const [path, tracked] of Object.entries(mirror.notes)) {
    if (
      seen.has(path) ||
      inForeignCopy(path) ||
      waits.has(tracked.id) ||
      sending.asked?.has(tracked.id) ||
      untold[tracked.id] ||
      underUnread(path, unread)
    )
      continue

    if (isAside(path) && (await present(joinPath(root, path)))) continue
    if (await evictedHere(joinPath(root, path))) continue
    const aside = await asideFound(root, path, tracked.id)
    if (aside !== null) {
      await shownAgain(mirror, aside, tracked.id, new Set())
      continue
    }
    if (await wordsWaitIn(token, tracked.id, tracked.hash, unplaced)) continue

    if (!(await deletedOnAccount(token, tracked.id))) continue

    mirror.notes = without(mirror.notes, path)
    mirror.offered = without(mirror.offered, path)
    moved = true
  }

  if (full) throw full
  return moved
}

async function deletedOnAccount(token: string, id: string): Promise<boolean> {
  try {
    await api.deleteNote(token, id)
    return true
  } catch (error) {
    if (isGone(error)) return true

    log('warn', `sync: delete of ${id} not taken - ${String(error)}`)
    return false
  }
}

function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
}

async function pushFiles(
  mirror: Mirror,
  root: string,
  listed: readonly Entry[],
  token: string,
  unread: readonly string[],
  sending: Sending,
): Promise<boolean> {
  const refused = refusedOf(mirror)
  const held: Record<string, TrackedFile> = {}
  const manifest: SpaceFile[] = []

  for (const [path, tracked] of Object.entries(mirror.files)) {
    if (!underUnread(path, unread)) continue
    held[path] = tracked
    manifest.push({ path, hash: tracked.hash })
  }

  for (const file of listed) {
    const path = relativeTo(root, file.path)
    if (!isPdfTarget(file.name) && !dressesTheSite(path)) continue
    const tracked = mirror.files[path]
    if (refused.papers.get(path) === file.modified) {
      if (tracked) {
        held[path] = tracked
        manifest.push({ path, hash: tracked.hash })
      }
      continue
    }

    const hash = tracked?.modified === file.modified ? tracked.hash : await hashFile(file.path)
    if (hash === null) continue

    held[path] = { hash, modified: file.modified }
    manifest.push({ path, hash })
  }

  if (same(mirror.files, held)) return false

  const said = JSON.stringify(manifest)
  if (refused.list === said) return false
  const saved = () =>
    api.saveSpaceFiles(token, mirror.spaceId, manifest).catch((error: unknown) => {
      if (!refusesIt(error)) throw error
      log('warn', `sync: the files of ${mirror.spaceId} not taken - ${String(error)}`)
      refused.list = said
      for (const file of manifest) {
        if (mirror.files[file.path]?.hash !== file.hash) sending.refused?.(file.path)
      }
      return null
    })
  const first = await saved()
  if (!first) return false
  const { missing } = first

  const unsent = new Set<string>()
  if (missing.length) {
    const wanted = new Set(missing)

    for (const file of manifest) {
      if (!wanted.has(file.hash)) continue

      const bytes = await invoke<ArrayBuffer>('read_file', {
        path: joinPath(root, file.path),
      }).catch(() => null)
      if (bytes) {
        try {
          await api.putBlob(token, file.hash, contentTypeOf(file.path), bytes)
        } catch (error) {
          if (!refusesIt(error)) throw error
          log('warn', `sync: ${file.path} not taken - ${String(error)}`)
          refused.papers.set(file.path, held[file.path]?.modified ?? 0)
          sending.refused?.(file.path)
          const was = mirror.files[file.path]
          if (was) {
            held[file.path] = was
            file.hash = was.hash
          } else {
            unsent.add(file.path)
          }
        }
      } else unsent.add(file.path)
    }

    if (!(await saved())) return false
  }

  mirror.files = Object.fromEntries(Object.entries(held).filter(([path]) => !unsent.has(path)))
  return true
}

const DRESSING = new Set(['publish.css', 'publish.js'])

function dressesTheSite(path: string): boolean {
  return DRESSING.has(path.toLowerCase())
}

function contentTypeOf(path: string): string {
  if (path.toLowerCase().endsWith('.css')) return 'text/css'
  if (path.toLowerCase().endsWith('.js')) return 'text/javascript'

  return 'application/pdf'
}

async function hashFile(path: string): Promise<string | null> {
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes === null ? null : sha256(bytes)
}

function same(was: Record<string, TrackedFile>, now: Record<string, TrackedFile>): boolean {
  const paths = Object.keys(now)

  return (
    paths.length === Object.keys(was).length &&
    paths.every((path) => was[path]?.hash === now[path]?.hash)
  )
}

async function create(
  mirror: Mirror,
  token: string,
  path: string,
  content: string,
  sending: Sending,
): Promise<boolean> {
  const offered = await sha256(content)
  const earlier = mirror.offered[path]
  mirror.offered = { ...mirror.offered, [path]: offered }

  try {
    const { note } = await api.createNote(token, mirror.spaceId, path, content)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    mirror.offered = without(mirror.offered, path)
    return true
  } catch (error) {
    if (refusesIt(error)) {
      noteRefused(mirror, path, offered, error, earlier, sending)
      return false
    }
    if (isFull(error)) notInTheAir(mirror, path, earlier)
    if (!(error instanceof ApiError) || error.status !== 409) throw error

    const body = isRecord(error.body) ? error.body : {}
    const theirs = isRecord(body.note) ? body.note : null
    if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) throw error

    const tracked: Tracked = { id: theirs.id, version: theirs.version, hash: theirs.hash }

    const hash = await sha256(content)
    if (hash === tracked.hash) {
      mirror.notes[path] = tracked
      mirror.offered = without(mirror.offered, path)
      return false
    }

    if (earlier && tracked.hash === earlier) {
      mirror.notes[path] = tracked
      mirror.offered = without(mirror.offered, path)
      return false
    }

    const held = isString(body.content) ? body : await wordsOf(token, tracked.id, body)
    if (!held) {
      mirror.offered = without(mirror.offered, path)
      return false
    }
    mirror.notes[path] = tracked
    try {
      await keepBoth(mirror, path, tracked, held, token, null)
    } catch (again) {
      if (refusesIt(again)) {
        noteRefused(mirror, path, offered, again, earlier, sending)
        return true
      }
      if (!(again instanceof NotWritten)) throw again
      log('warn', `sync: ${path} not paired - ${again.message}`)
      mirror.notes = without(mirror.notes, path)
      mirror.offered = without(mirror.offered, path)
      return false
    }
    return true
  }
}

async function wordsOf(
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const { content } = await api.readNote(token, id)
    return { ...body, content }
  } catch (error) {
    log('warn', `sync: ${id} not read for a copy - ${String(error)}`)
    return null
  }
}

function caughtUpWith(mirror: Mirror, path: string, refusal: unknown): boolean {
  const body = isRecord(refusal) ? refusal : {}
  const theirs = isRecord(body.note) ? body.note : null
  if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) return false

  mirror.notes[path] = { id: theirs.id, version: theirs.version, hash: theirs.hash }
  mirror.offered = without(mirror.offered, path)
  return true
}

async function keepBoth(
  mirror: Mirror,
  path: string,
  tracked: Tracked,
  conflict: unknown,
  token: string,
  base: string | null,
) {
  const server = isRecord(conflict) ? conflict : {}
  const theirs = isRecord(server.note) ? server.note : null
  if (typeof theirs?.version !== 'number') return

  const here = joinPath(mirror.root, path)
  const sent = isString(server.content) ? server.content : ''
  const ours = await invoke<string>('read_note', { path: here })
  const place = theirs.id === tracked.id && isString(theirs.path) ? theirs.path : path

  const together = await settled(path, ours, sent, () => Promise.resolve(false))
  if (together !== null) {
    await writeDown(here, together, ours)
    const { note } = await api.writeNote(token, tracked.id, place, together, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  const merged = base === null ? null : await mergedOver(token, here, tracked.id, base, ours, sent)
  if (merged !== null) {
    await writeDown(here, merged, ours)
    const { note } = await api.writeNote(token, tracked.id, place, merged, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  if (carriedOwn(path)) {
    const both = withTasksOf(ours, sent)
    await writeDown(here, both, ours)
    const { note } = await api.writeNote(token, tracked.id, place, both, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  await writeDown(conflictPath(here), sent)

  const { note } = await api.writeNote(token, tracked.id, place, ours, theirs.version)
  mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
}
