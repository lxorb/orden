/** The file commands for a space Orden keeps itself, answered on a desktop (#1068, step
 *  4c): by the browser build's own commands over that space's folder mounted as rows
 *  (web/commands.ts, internal/rows.ts), so the desktop and the browser are one
 *  implementation.
 *
 *  The browser's commands speak its own paths, `/` between folders and a space a folder
 *  at the top (`/<name>`). So every path a call names is turned into that space's
 *  address there on the way in, and every path an answer names back into the root the
 *  app holds on the way out. A call that names a kept space and something else - a
 *  move out of one into a folder, or into another kept space - is refused, loudly:
 *  neither side could make it alone, and the crate making it would write a file where
 *  nothing of the space is on the disk. Recently deleted holds both sides' trash, so
 *  its four commands are answered by both. */

import { joinPath } from '../tauri'
import { normalise } from '../web/paths'
import type { Trashed } from '../web/store'
import { type Mounted, mountOf, mounts as mounted, PATH_ARGS } from './roots'

/** The crate's answer, through the one door to it. */
async function crate<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('../native')
  return invoke<T>(command, args)
}

async function web<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { webInvoke } = await import('../web/commands')
  return webInvoke<T>(command, args)
}

/** A path at the browser's address of a kept space, back at its root here. */
function outOf(mount: Mounted, path: string): string {
  const at = normalise(path)
  if (at === mount.web) return mount.root
  if (!at.startsWith(`${mount.web}/`)) return path
  return joinPath(mount.root, at.slice(mount.web.length + 1))
}

interface Entry {
  name: string
  path: string
  children?: Entry[]
}

function treeOut(mount: Mounted, entry: Entry, top: boolean): Entry {
  return {
    ...entry,
    ...(top && normalise(entry.path) === mount.web
      ? {
          name:
            mount.root
              .replace(/[\\/]+$/, '')
              .split(/[\\/]/)
              .pop() ?? entry.name,
        }
      : {}),
    path: outOf(mount, entry.path),
    ...(entry.children
      ? { children: entry.children.map((one) => treeOut(mount, one, false)) }
      : {}),
  }
}

/** A trashed thing of a kept space, where it came from said as the app says it. */
function trashedOut(entry: Trashed, mounts: readonly Mounted[]): Trashed {
  for (const mount of mounts) {
    const from = outOf(mount, entry.from)
    if (from !== entry.from) return { ...entry, from }
  }
  return entry
}

/** The trash commands, which reach both: the crate's trash, and every kept space's. */
async function trash<T>(
  command: string,
  args: Record<string, unknown>,
  mounts: readonly Mounted[],
): Promise<T> {
  const kept = (await web<Trashed[]>('list_trash')).map((one) => trashedOut(one, mounts))
  if (command === 'list_trash') {
    const all = [...(await crate<Trashed[]>('list_trash')), ...kept]
    return all.sort((a, b) => b.trashedAt - a.trashedAt) as T
  }
  if (command === 'purge_trash_older_than') {
    const [here, there] = await Promise.all([
      crate<number>(command, args),
      web<number>(command, args),
    ])
    return (here + there) as T
  }
  if (!kept.some((one) => one.id === args.id)) return crate<T>(command, args)
  const answer = await web<unknown>(command, args)
  if (command !== 'restore_trash' || typeof answer !== 'string') return answer as T
  for (const mount of mounts) {
    const back = outOf(mount, answer)
    if (back !== answer) return back as T
  }
  return answer as T
}

/** One call that names a kept space, or Recently deleted. */
export async function internalInvoke<T>(
  command: string,
  args: Record<string, unknown> = {},
  mounts: readonly Mounted[] = mounted(),
): Promise<T> {
  if (
    command === 'list_trash' ||
    command === 'restore_trash' ||
    command === 'purge_trash' ||
    command === 'purge_trash_older_than'
  ) {
    return trash<T>(command, args, mounts)
  }

  let mount: Mounted | null = null
  const inWeb: Record<string, unknown> = { ...args }
  for (const key of PATH_ARGS) {
    const value = args[key]
    if (typeof value !== 'string') continue
    const found = mountOf(value)
    if (!found || (mount && found.mount !== mount)) {
      throw new Error(
        `${String(args.from ?? args.path)} and ${String(args.to ?? args.notePath)} are kept apart, and nothing can go from one to the other yet`,
      )
    }
    mount = found.mount
    inWeb[key] = found.inside ? `${found.mount.web}/${found.inside}` : found.mount.web
  }
  if (!mount) throw new Error(`${command} names no space kept here`)
  const named = typeof args.path === 'string' ? args.path : args.root
  const at = (typeof named === 'string' ? mountOf(named)?.inside : undefined) ?? ''

  switch (command) {
    // The crate's own shapes, which the browser's commands do not have.
    case 'read_file': {
      const bytes = await mount.folder.read(at)
      if (!bytes) throw new Error(`no file at ${String(args.path)}`)
      return bytes.slice().buffer as T
    }
    case 'file_stamp': {
      const entry = await mount.folder.at(at)
      return (entry?.key ? { modified: entry.modified, len: entry.size } : null) as T
    }
    case 'read_tree': {
      // A folder's tree, as the crate refuses one of what is not a folder.
      const entry = await mount.folder.at(at)
      if (at && (!entry || entry.key)) throw new Error(`${String(args.root)} is not a folder`)
      const tree = await web<Entry>(command, inWeb)
      return treeOut(mount, tree, true) as T
    }
    case 'trash_item':
    case 'trash_words': {
      const entry = await web<Trashed>(command, inWeb)
      return { ...entry, from: outOf(mount, entry.from) } as T
    }
    default:
      return web<T>(command, inWeb)
  }
}
