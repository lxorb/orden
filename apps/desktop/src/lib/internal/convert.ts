/** A space that is a folder becoming one Orden keeps itself, once on each device
 *  (#1068, step 4e), where the device says new spaces are kept so (`keepsNewSpaces`).
 *
 *  Every file the space holds is copied into a folder of Orden's own under the path it
 *  had, and every copy read back and checked against the file it came from, before the
 *  space is anything but the folder it was. Only then, with every open note's writes
 *  held, is what changed since copied again, and the space moves to its new root as a
 *  rename does (`fileMoved`): everything kept by path follows it, the sync engine's
 *  entries keep their ids and their places, since every path inside is the one it was.
 *
 *  Before anything, the folder is copied whole into `.orden/.backups`. Then it is left
 *  exactly as it was, and is not listed or written again: the kept space says which
 *  folder it came from (`.from`), and a build from before reads that folder as it always
 *  did. A space whose copy did not check out - a full disk, a file that read back wrong,
 *  two names one name here - stays the folder, and is tried again at the next launch;
 *  one a crash cut short says so (`CONVERTING`), is never listed, and is begun again.
 *  And a space made of a folder can be turned back into it (`revertSpace`). */

import { toBase64 } from '../bytes'
import { log } from '../log'
import { invoke as crate } from '../native'
import { joinPath, platform } from '../tauri'
import type { HoldsSpaces } from '../workspace/spaces'
import { folderBytes } from './bytes'
import { InternalFolder } from './folder'
import { mountOf } from './roots'
import {
  CONVERTING,
  HOME,
  keepAsFolder,
  keepsNewSpaces,
  keptAsFolders,
  keptFrom,
  madeFrom,
  mountKept,
  unkeep,
} from './spaces'

interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}

interface Stamp {
  modified: number
  len: number
}

const foldsCase = () => ['windows', 'macos', 'ios', ''].includes(platform())

/** The space's inbox, which every listing leaves out as the app's own (#1044) and which
 *  is the space's all the same. */
const INBOX = '.Inbox.md'

/** What says a folder was an Obsidian vault, where a task's `📅` is a deadline (#371,
 *  rows/vault.ts): the files Obsidian writes into `.obsidian`, carried so the space
 *  reads its tasks as it did. The rest of Obsidian's settings stay with the folder. */
const VAULT = ['.obsidian/app.json', '.obsidian/workspace.json', '.obsidian/core-plugins.json']

/** Everything in the folder at `root`, by its path inside with `/` between folders: what
 *  the file list holds, what pages hold as their papers, every other file, and the inbox
 *  - the app's other dotted files are the app's, and stay with the folder. */
async function contents(root: string): Promise<{ path: string; dir: boolean }[]> {
  const tree = await crate<Listed>('read_tree', {
    root,
    options: { every: true, papers: true, showHidden: false },
  })
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const out: { path: string; dir: boolean }[] = []
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      out.push({ path: child.path.replace(/\\/g, '/').slice(base.length + 1), dir: child.is_dir })
      if (child.is_dir) walk(child)
    }
  }
  walk(tree)
  for (const own of [INBOX, ...VAULT]) {
    if (await crate<Stamp | null>('file_stamp', { path: joinPath(root, own) }).catch(() => null)) {
      out.push({ path: own, dir: false })
    }
  }
  return out
}

async function bytesAt(path: string): Promise<Uint8Array> {
  return new Uint8Array(await crate<ArrayBuffer>('read_file', { path }))
}

function same(one: Uint8Array, other: Uint8Array | null): boolean {
  if (other?.byteLength !== one.byteLength) return false
  for (let at = 0; at < one.byteLength; at += 1) if (one[at] !== other[at]) return false
  return true
}

/** Each file of the folder at `root` into `into`, read back and checked, and the stamp
 *  each had when it was read. Throws where one did not check out, and, on the first
 *  copy, where two names of the folder are one name here. */
async function copied(
  root: string,
  into: InternalFolder,
  only: ReadonlySet<string> | null = null,
): Promise<Map<string, Stamp | null>> {
  const stamps = new Map<string, Stamp | null>()
  for (const one of await contents(root)) {
    if (only && !only.has(one.path)) continue
    if (one.dir) {
      await into.mkdir(one.path)
      continue
    }
    if (!only && into.atNow(one.path)) {
      throw new Error(`${one.path} and another file are one name in a space kept here`)
    }
    const at = joinPath(root, one.path)
    stamps.set(one.path, await crate<Stamp | null>('file_stamp', { path: at }).catch(() => null))
    const bytes = await bytesAt(at)
    await into.write(one.path, bytes)
    if (!same(bytes, await into.read(one.path))) {
      throw new Error(`${one.path} did not read back as it was written`)
    }
  }
  return stamps
}

/** A copy of the folder at `from`, whole, kept beside the kept spaces where nothing
 *  lists it (`.orden/.backups`), before anything is made of it or written back into it:
 *  what is there to go back to whatever happens after. Answers where. */
async function backedUp(from: string, name: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', ' ')
  const backups = joinPath(joinPath(await crate<string>('spaces_root'), HOME), '.backups')
  let at = joinPath(backups, `${name} ${stamp}`)
  for (let counter = 2; await crate<boolean>('path_taken', { path: at }); counter += 1) {
    at = joinPath(backups, `${name} ${stamp} ${String(counter)}`)
  }
  await crate('copy_path', { from, to: at })
  return at
}

/** One conversion or reversion at a time, in every call to this module. */
let turn: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
  const mine = turn.then(run, run)
  turn = mine.catch(() => undefined)
  return mine
}

/** The space `id` of `ws`, a folder until now, made one Orden keeps itself. Answers
 *  whether it was.
 *
 *  The folder is copied whole into `.orden/.backups` first. The kept folder says it is
 *  being made (`CONVERTING`) until the moment the space moves to it, so one a crash or a
 *  full disk cut short is never listed, and is made again from the start next time. */
export function convertSpace(ws: HoldsSpaces, id: string): Promise<boolean> {
  return oneAtATime(() => converting(ws, id))
}

async function converting(ws: HoldsSpaces, id: string): Promise<boolean> {
  const space = ws.spaces.find((one) => one.id === id)
  if (!space || mountOf(space.root)) return false
  const from = space.root
  const folder = joinPath(joinPath(await crate<string>('spaces_root'), HOME), space.name)
  const marker = joinPath(folder, CONVERTING)
  if (await crate<unknown>('read_tree', { root: folder }).then(Boolean, () => false)) {
    // A kept space of that name already: this one stays the folder rather than become
    // a space under a name it never had. One cut short is begun again.
    if (!(await crate<unknown>('file_stamp', { path: marker }).catch(() => null))) return false
    await crate('delete_folder', { path: folder })
  }

  try {
    await backedUp(from, space.name)
  } catch (error) {
    log('error', `${space.name} stays a folder: it could not be backed up: ${String(error)}`)
    return false
  }
  await crate('write_note', { path: marker, content: from })
  const world = { now: () => Date.now(), key: () => crypto.randomUUID(), foldsCase: foldsCase() }
  const into = await InternalFolder.open(folder, folderBytes(folder), world)
  try {
    const stamps = await copied(from, into)
    // Written inside the hold's own callback, so read back through a holder.
    const done = { converted: false }
    await ws.holdingUnder(from, async () => {
      // What changed while the rest was being copied, copied again, now that nothing
      // more can change; and what came or went meanwhile.
      const now = await contents(from)
      const changed = new Set<string>()
      for (const one of now) {
        if (one.dir) continue
        const was = stamps.get(one.path)
        const is = await crate<Stamp | null>('file_stamp', { path: joinPath(from, one.path) })
        if (!is || is.modified !== was?.modified || is.len !== was.len) changed.add(one.path)
      }
      for (const one of now) if (one.dir && !(await into.at(one.path))) changed.add(one.path)
      // What is there now, and the folders it is in.
      const there = new Set<string>()
      for (const { path } of now) {
        for (let at = path; at; at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : '') {
          there.add(at)
        }
      }
      for (const { path } of await into.list()) if (!there.has(path)) await into.remove(path)
      await copied(from, into, changed)
      await into.flush()
      into.close()

      const root = await mountKept(folder, space.name, from)
      // From here the kept space is the space: a crash now finds it whole.
      await crate('delete_note', { path: marker })
      space.root = root
      await ws.fileMoved(from, root, 'space')
      // Each note's versions, kept by its path in the app's own folder, under the path
      // it has now (`rehome_snapshots` in history.rs).
      await crate('rehome_snapshots', { from, to: root }).catch(() => 0)
      done.converted = true
    })
    if (!done.converted) return false
    ws.persist()
    await ws.loadTree()
    return true
  } catch (error) {
    into.close()
    // Nothing of the folder was touched; what was copied waits to be copied again.
    await crate('delete_folder', { path: folder }).catch(() => undefined)
    log('error', `${space.name} stays a folder: ${String(error)}`)
    return false
  }
}

/** Every space of `ws` that is still a folder, made one Orden keeps itself, one at a
 *  time, where this device says so - bar those turned back into folders. */
export async function convertAll(ws: HoldsSpaces): Promise<void> {
  if (!keepsNewSpaces()) return
  const done = new Set([...(await keptFrom()), ...(await keptAsFolders())])
  for (const space of [...ws.spaces]) {
    if (mountOf(space.root) || done.has(space.root)) continue
    await convertSpace(ws, space.id)
  }
}

/** The kept space `id` of `ws`, made of a folder, a folder again: that folder backed up
 *  whole, then every file of the space written into it as the space has it now, and what
 *  the space no longer has taken into Recently deleted; then the space moves back to the
 *  folder as a rename does, and its kept folder goes into Recently deleted whole. The
 *  folder is not made into a kept space again on this device. Answers whether it was. */
export function revertSpace(ws: HoldsSpaces, id: string): Promise<boolean> {
  return oneAtATime(() => reverting(ws, id))
}

async function reverting(ws: HoldsSpaces, id: string): Promise<boolean> {
  const space = ws.spaces.find((one) => one.id === id)
  const found = space ? mountOf(space.root) : null
  const to = space ? madeFrom(space.root) : undefined
  if (!space || !found || found.inside || !to) return false
  const root = space.root
  const there = await crate<unknown>('read_tree', { root: to }).then(Boolean, () => false)
  if (there) await backedUp(to, space.name)

  const done = { reverted: false }
  await ws.holdingUnder(root, async () => {
    const folder = found.mount.folder
    const kept = await folder.list()
    for (const { path, entry } of kept) {
      const at = joinPath(to, path)
      if (!entry.key) {
        await crate('create_folder', { path: at })
        continue
      }
      const bytes = await folder.read(path)
      if (!bytes) throw new Error(`${path} could not be read`)
      await crate('write_bytes', { path: at, base64: toBase64(bytes) })
    }
    // What the space no longer has, into Recently deleted rather than back as a note
    // nobody wrote: the backup above holds it too.
    const has = new Set(kept.map((one) => one.path))
    for (const one of there ? await contents(to) : []) {
      if (one.dir || has.has(one.path)) continue
      await crate('trash_item', { path: joinPath(to, one.path), kind: 'note' }).catch(
        () => undefined,
      )
    }
    await keepAsFolder(to)
    await unkeep(root)
    space.root = to
    await ws.fileMoved(root, to, 'space')
    await crate('rehome_snapshots', { from: root, to }).catch(() => 0)
    done.reverted = true
  })
  if (!done.reverted) return false
  ws.persist()
  await ws.loadTree()
  return true
}
